import '@testing-library/jest-dom/vitest';

// jsdom has no object-URL implementation, so `downloadBlob` (which hands a Blob
// to a synthetic anchor click) would throw in every test that exercises a
// download. A stub that returns a stable fake URL is enough - nothing decodes it.
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => 'blob:creatordna-test',
    writable: true,
    configurable: true,
  });
}
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: () => undefined,
    writable: true,
    configurable: true,
  });
}
