#!/usr/bin/env node
'use strict';

// Read-only DDS header inspection; no pixel decoding or payload validation.
// References: Microsoft DDS_HEADER, DDS_PIXELFORMAT, DDS_HEADER_DXT10,
// DXGI_FORMAT. Workflow adapted from scnjwyc skill bundle b92d85e (see ref 33).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dxgiNames = new Map([
  [70, 'BC1_TYPELESS'], [71, 'BC1_UNORM'], [72, 'BC1_UNORM_SRGB'],
  [73, 'BC2_TYPELESS'], [74, 'BC2_UNORM'], [75, 'BC2_UNORM_SRGB'],
  [76, 'BC3_TYPELESS'], [77, 'BC3_UNORM'], [78, 'BC3_UNORM_SRGB'],
  [79, 'BC4_TYPELESS'], [80, 'BC4_UNORM'], [81, 'BC4_SNORM'],
  [82, 'BC5_TYPELESS'], [83, 'BC5_UNORM'], [84, 'BC5_SNORM'],
  [94, 'BC6H_TYPELESS'], [95, 'BC6H_UF16'], [96, 'BC6H_SF16'],
  [97, 'BC7_TYPELESS'], [98, 'BC7_UNORM'], [99, 'BC7_UNORM_SRGB'],
]);

function parseHeader(buffer) {
  if (buffer.length < 128 || buffer.toString('ascii', 0, 4) !== 'DDS ') {
    throw new Error('Not a DDS file or truncated base header');
  }
  const u32 = offset => buffer.readUInt32LE(offset);
  if (u32(4) !== 124 || u32(76) !== 32) throw new Error('Invalid DDS header sizes');
  const height = u32(12), width = u32(16), mipRaw = u32(28);
  if (width === 0 || height === 0) throw new Error('Zero DDS dimensions');
  const mipCount = mipRaw || 1;
  const depth = u32(24);
  const maxMip = Math.floor(Math.log2(Math.max(width, height, depth || 1))) + 1;
  if (mipCount > maxMip) throw new Error('Mip count exceeds possible dimension chain');
  const flags = u32(8), pixelFlags = u32(80);
  const hasFourCC = (pixelFlags & 0x4) !== 0;
  const fourCC = hasFourCC ? buffer.toString('latin1', 84, 88) : null;
  let format = 'UNCOMPRESSED_OR_UNKNOWN', dxgi = null, dx10 = null;
  let headerBytes = 128, colorSpace = 'unspecified';
  if (fourCC === 'DX10') {
    if (buffer.length < 148) throw new Error('Truncated DX10 header');
    dxgi = u32(128);
    format = dxgiNames.get(dxgi) || `UNKNOWN_DXGI_${dxgi}`;
    dx10 = { resourceDimension: u32(132), miscFlag: u32(136),
      arraySize: u32(140), alphaMode: u32(144) & 7 };
    if (dx10.arraySize === 0) throw new Error('Zero DX10 array size');
    if (![2, 3, 4].includes(dx10.resourceDimension)) throw new Error('Invalid DX10 texture dimension');
    headerBytes = 148;
    colorSpace = format.endsWith('_SRGB') ? 'sRGB'
      : format.endsWith('_TYPELESS') || format.startsWith('UNKNOWN') ? 'unspecified' : 'linear';
  } else if (fourCC) {
    format = ({ DXT1: 'BC1', DXT2: 'BC2_PREMULTIPLIED', DXT3: 'BC2',
      DXT4: 'BC3_PREMULTIPLIED', DXT5: 'BC3', ATI1: 'BC4', ATI2: 'BC5',
      BC4U: 'BC4_UNORM', BC4S: 'BC4_SNORM', BC5U: 'BC5_UNORM', BC5S: 'BC5_SNORM' })[fourCC]
      || 'UNKNOWN_FOURCC';
  }
  let alpha = 'unknown: inspect material and decoded pixels';
  if (format.startsWith('BC1')) alpha = 'possible 1-bit alpha: header cannot prove transparent pixels';
  else if (/^BC[237]/.test(format)) alpha = 'alpha capable: decode to verify preservation and use';
  else if (/^BC[456]/.test(format)) alpha = 'no dedicated alpha channel: check material channel use';
  else if (!hasFourCC && (pixelFlags & 3)) alpha = 'header declares alpha: decode to verify';
  return { width, height, depth, mipCount, mipCountRaw: mipRaw,
    mipCountFlag: (flags & 0x20000) !== 0, flags, pixelFlags, fourCC, dxgi,
    format, colorSpace, alpha, dx10, caps2: u32(112), headerBytes,
    payloadBytes: buffer.length - headerBytes,
    validationScope: 'header only; pixels and compressed payload not validated' };
}

function inspectFile(file) {
  const resolved = path.resolve(file);
  const buffer = fs.readFileSync(resolved);
  return { file: resolved, bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'), ...parseHeader(buffer) };
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node dds-inspect.js <file.dds> [more.dds ...]\nRead-only header + SHA256; no pixel or compressed payload validation.');
    return 0;
  }
  if (!args.length || args.some(arg => arg.startsWith('--'))) {
    console.error('Usage: node dds-inspect.js <file.dds> [more.dds ...]');
    return 2;
  }
  let failed = false;
  const result = args.map(file => {
    try { return inspectFile(file); }
    catch (error) { failed = true; return { file: path.resolve(file), error: error.message }; }
  });
  console.log(JSON.stringify(result, null, 2));
  return failed ? 1 : 0;
}

module.exports = { parseHeader, inspectFile };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
