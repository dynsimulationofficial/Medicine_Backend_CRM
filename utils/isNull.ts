export function isNull (val: unknown): boolean {
    if (typeof val === 'string') { val = val.trim(); }
    if (typeof val === 'number' && val == 0) { return true; }
    if (typeof val === 'object' && (JSON.stringify(val) === '{}' || JSON.stringify(val) === '[]')) { return true; }
    if (val === '' || val === null || typeof val === 'undefined' || val === '' || val === 'undefined' || typeof val === undefined) {
      return true;
    } else {
      return false;
    }
  }
