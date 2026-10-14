// Texture loading helpers: plain PBR sets and packed texture arrays for terrain splatting.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

export function tex(url, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const key = url + (srgb ? '|s' : '');
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function pbrSet(name, opts = {}) {
  const base = `assets/textures/${name}/`;
  return {
    map: tex(base + 'diff.jpg', { srgb: true, ...opts }),
    normalMap: tex(base + 'nor.jpg', opts),
    arm: tex(base + 'arm.jpg', opts),
  };
}

async function decode(url, size) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

export async function textureArray(urls, size, { srgb = false, aniso = 8 } = {}) {
  const data = new Uint8Array(size * size * 4 * urls.length);
  const layers = await Promise.all(urls.map(u => decode(u, size)));
  layers.forEach((px, i) => data.set(px, i * size * size * 4));
  const t = new THREE.DataArrayTexture(data, size, size, urls.length);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function imageTexture(url, { srgb = false, nearest = false } = {}) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (nearest) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else { t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export async function fetchGzip(url) {
  const res = await fetch(url);
  const ds = new DecompressionStream('gzip');
  return await new Response(res.body.pipeThrough(ds)).arrayBuffer();
}
