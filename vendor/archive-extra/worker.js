import SevenZip from './7zz.es6.js';

const quiet = ['-bd', '-bso0', '-bsp0', '-bse0'];

function mount(zip, files) {
  zip.FS.mkdir('/input');
  zip.FS.mount(zip.WORKERFS, { blobs: files.map(({ name, blob }) => ({ name, data: blob })) }, '/input');
}

function command(zip, args) {
  if (zip.callMain([...args, ...quiet]) !== 0) throw new Error('7-Zip could not process this archive.');
}

async function unpack(file, codec, limit) {
  const chunks = [];
  let block = new Uint8Array(65536);
  let offset = 0;
  let total = 0;
  const zip = await SevenZip({
    stdin: () => null,
    stdout(byte) {
      if (++total > limit) throw new Error('Expanded archives are limited to 120 MB.');
      block[offset++] = byte;
      if (offset === block.length) {
        chunks.push(block);
        block = new Uint8Array(block.length);
        offset = 0;
      }
    },
    stderr: () => {},
  });
  mount(zip, [{ name: 'source', blob: file }]);
  command(zip, ['x', '-so', `-t${codec}`, '/input/source']);
  return new Blob([...chunks, block.subarray(0, offset)]);
}

const tarCompression = { tgz: ['gzip', 'gz'], tbz2: ['bzip2', 'bz2'], txz: ['xz', 'xz'] };

async function pack(files, format) {
  const zip = await SevenZip({ stdin: () => null, printErr: () => {} });
  mount(zip, files);
  const [compression, suffix] = tarCompression[format] || [];
  const output = `/output.${suffix || format}`;
  const archive = compression ? '/payload.tar' : output;
  zip.FS.chdir('/input');
  command(zip, ['a', '-spd', '-mx=1', `-t${compression ? 'tar' : format}`, archive, ...files.map(file => `./${file.name}`)]);
  if (compression) command(zip, ['a', '-mx=1', `-t${compression}`, output, archive]);
  return new Blob([zip.FS.readFile(output)], { type: 'application/octet-stream' });
}

self.onmessage = async ({ data }) => {
  try {
    const blob = data.files
      ? await pack(data.files, data.format)
      : await unpack(data.file, data.codec, data.limit);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error.message || 'The archive operation failed.' });
  }
};
