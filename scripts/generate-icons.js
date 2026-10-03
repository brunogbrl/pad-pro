const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const resedit = require('resedit');

function createDIBIconData(rawBitmap, width, height) {
  const pixelBytes = width * height * 4;
  const maskRowBytes = Math.ceil(width / 32) * 4;
  const maskBytes = maskRowBytes * height;
  const dataSize = 40 + pixelBytes + maskBytes;
  const buf = Buffer.alloc(dataSize);

  // 1. BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, 0);                      // biSize = 40
  buf.writeInt32LE(width, 4);                    // biWidth
  buf.writeInt32LE(height * 2, 8);               // biHeight (doubled for XOR + AND masks)
  buf.writeUInt16LE(1, 12);                      // biPlanes = 1
  buf.writeUInt16LE(32, 14);                     // biBitCount = 32
  buf.writeUInt32LE(0, 16);                      // biCompression = 0 (BI_RGB)
  buf.writeUInt32LE(pixelBytes + maskBytes, 20); // biSizeImage
  buf.writeInt32LE(0, 24);                       // biXPelsPerMeter
  buf.writeInt32LE(0, 28);                       // biYPelsPerMeter
  buf.writeUInt32LE(0, 32);                      // biClrUsed
  buf.writeUInt32LE(0, 36);                      // biClrImportant

  // 2. Pixel data: copy from bottom row to top row (BGRA)
  const rowBytes = width * 4;
  let dstOffset = 40;
  for (let y = height - 1; y >= 0; y--) {
    const srcOffset = y * rowBytes;
    rawBitmap.copy(buf, dstOffset, srcOffset, srcOffset + rowBytes);
    dstOffset += rowBytes;
  }

  // 3. 1-bit AND mask: 1 for transparent, 0 for opaque
  for (let y = height - 1; y >= 0; y--) {
    const srcRow = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const alpha = rawBitmap[srcRow + x * 4 + 3];
      if (alpha === 0) {
        const maskByteIndex = dstOffset + ((height - 1 - y) * maskRowBytes) + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        buf[maskByteIndex] |= (1 << bitIndex);
      }
    }
  }

  return buf;
}

function buildICO(entries) {
  // ICONDIR: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(entries.length, 4); // number of icons

  let offset = 6 + (16 * entries.length);
  const dirBuffers = [];
  const dataBuffers = [];

  for (const item of entries) {
    const entry = Buffer.alloc(16);
    const w = item.width >= 256 ? 0 : item.width;
    const h = item.height >= 256 ? 0 : item.height;
    entry.writeUInt8(w, 0);
    entry.writeUInt8(h, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(item.data.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset

    dirBuffers.push(entry);
    dataBuffers.push(item.data);
    offset += item.data.length;
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

app.whenReady().then(() => {
  try {
    const srcPath = 'C:\\Users\\PMCL\\.gemini\\antigravity-ide\\brain\\33f6dc4b-ee1c-47a7-ace4-ec706eadecc0\\.user_uploaded\\media_1789497428152.png';
    if (!fs.existsSync(srcPath)) {
      console.error('Source image not found:', srcPath);
      app.exit(1);
      return;
    }

    const sourceImage = nativeImage.createFromPath(srcPath);
    console.log('Source image size:', sourceImage.getSize());

    const buildDir = path.join(__dirname, '..', 'build');
    const picoDriveDir = 'I:\\';

    // 1. High-res 512x512 and 256x256 PNGs
    const img512 = sourceImage.resize({ width: 512, height: 512, quality: 'best' });
    fs.writeFileSync(path.join(buildDir, 'icon.png'), img512.toPNG());

    // 2. Build multi-resolution ICO with genuine DIB (uncompressed Windows bitmap)
    // Windows Explorer drive icons and shell autorun strictly require DIB headers (0x28).
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const icoEntries = [];

    for (const size of sizes) {
      const resized = sourceImage.resize({ width: size, height: size, quality: 'best' });
      const rawBitmap = resized.toBitmap(); // returns top-to-bottom BGRA
      const dibData = createDIBIconData(rawBitmap, size, size);
      icoEntries.push({ width: size, height: size, data: dibData });
      console.log(`Generated DIB icon frame: ${size}x${size} (${dibData.length} bytes)`);
    }

    const icoBuffer = buildICO(icoEntries);

    // Verify with resedit
    try {
      const parsed = resedit.Data.IconFile.from(icoBuffer);
      console.log('Resedit validation: ICO has', parsed.icons.length, 'icons:');
      parsed.icons.forEach((ic, i) => {
        const isDIB = ic.data && ic.data.bitmapInfo;
        console.log(`  Frame ${i}: ${ic.width}x${ic.height}, bitCount: ${ic.bitCount}, isDIB: ${!!isDIB}`);
      });
    } catch (e) {
      console.warn('Resedit parse warning:', e.message);
    }

    // Save to build/icon.ico
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
    console.log('Wrote build/icon.ico successfully (' + icoBuffer.length + ' bytes)');

    // 3. Update Raspberry Pi Pico (I:\)
    if (fs.existsSync(picoDriveDir)) {
      try {
        // For Pico's 1MB flash, use 16, 24, 32, 48, 64 (only ~34KB total!) so it doesn't waste flash storage
        const picoSizes = [16, 24, 32, 48, 64];
        const picoIcoEntries = picoSizes.map(size => {
          const resized = sourceImage.resize({ width: size, height: size, quality: 'best' });
          const dibData = createDIBIconData(resized.toBitmap(), size, size);
          return { width: size, height: size, data: dibData };
        });
        const picoIcoBuffer = buildICO(picoIcoEntries);

        fs.writeFileSync(path.join(picoDriveDir, 'icon.ico'), picoIcoBuffer);
        fs.writeFileSync(path.join(picoDriveDir, 'streamdeck.ico'), picoIcoBuffer);
        
        // Remove heavy redundant icon.png on Pico if present to free space
        if (fs.existsSync(path.join(picoDriveDir, 'icon.png'))) {
          fs.unlinkSync(path.join(picoDriveDir, 'icon.png'));
        }

        // autorun.inf for Windows Explorer drive icon:
        const autorun = '[autorun]\r\nicon=icon.ico\r\nlabel=Sharkropad\r\n';
        fs.writeFileSync(path.join(picoDriveDir, 'autorun.inf'), autorun, 'utf8');

        console.log('Successfully updated Pico drive with lightweight DIB icon.ico (' + picoIcoBuffer.length + ' bytes) and autorun.inf!');
      } catch (err) {
        console.error('Error writing to Pico drive:', err.message);
      }
    }

    app.exit(0);
  } catch (err) {
    console.error('Error:', err);
    app.exit(1);
  }
});
