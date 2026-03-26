const fs = require('fs');
const path = require('path');

(async () => {
  const src = path.join(process.cwd(), 'default-icon.png');
  if (!fs.existsSync(src)) {
    console.error('ERROR: source image not found:', src);
    process.exit(2);
  }

  let JimpModule;
  try {
    JimpModule = require('jimp');
    // handle packages that return a Promise (ESM interop)
    if (JimpModule && typeof JimpModule.then === 'function') {
      JimpModule = await JimpModule;
    }
  } catch (e) {
    console.error('ERROR: missing dependency "jimp". Run: npm install jimp');
    process.exit(3);
  }

  // Normalize various export shapes (CJS, ESM default, nested Jimp)
  let Jimp = JimpModule;
  if (JimpModule && typeof JimpModule === 'object') {
    if (typeof JimpModule.read === 'function') {
      Jimp = JimpModule;
    } else if (JimpModule.default && typeof JimpModule.default.read === 'function') {
      Jimp = JimpModule.default;
    } else if (JimpModule.Jimp && typeof JimpModule.Jimp.read === 'function') {
      Jimp = JimpModule.Jimp;
    } else if (JimpModule.default && JimpModule.default.Jimp && typeof JimpModule.default.Jimp.read === 'function') {
      Jimp = JimpModule.default.Jimp;
    }
  }

  if (!Jimp || typeof Jimp.read !== 'function') {
    console.error('ERROR: incompatible "jimp" export. Ensure jimp is installed and importable.');
    process.exit(4);
  }

  const outDir = path.join(process.cwd(), 'icons');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 24, 32, 48, 128];
  let failures = 0;

  const writeImage = async (img, outPath) => {
    if (typeof img.writeAsync === 'function') {
      return img.writeAsync(outPath);
    }
    return new Promise((resolve, reject) => {
      try {
        const res = img.write(outPath, (err) => (err ? reject(err) : resolve()));
        // some implementations are synchronous and return the image
        if (res !== undefined) resolve();
      } catch (e) {
        reject(e);
      }
    });
  };

  const tryResize = (img, s) => {
    // Try object-style API first (newer jimp)
    try {
      if (typeof img.resize === 'function') {
        img.resize({ w: s, h: s });
        return;
      }
    } catch (e) {
      // fall through and try numeric form
    }

    // Try numeric-style API (older versions)
    if (typeof img.resize === 'function') {
      try {
        img.resize(s, s);
        return;
      } catch (e) {
        // fall through
      }
    }

    // As a final fallback, try scaleToFit
    if (typeof img.scaleToFit === 'function') {
      img.scaleToFit(s, s);
      return;
    }

    throw new Error('No compatible resize method found on image');
  };

  for (const s of sizes) {
    const out = path.join(outDir, `icon${s}.png`);
    try {
      const img = await Jimp.read(src);

      tryResize(img, s);

      await writeImage(img, out);

      console.log('Wrote', out);
    } catch (err) {
      failures += 1;
      console.error('Failed to write', out, err && err.message ? err.message : err);
    }
  }

  if (failures > 0) process.exit(1);
  console.log('Done');
})();
