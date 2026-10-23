export const accessState = (checked, authenticated, guestSelected) => !checked ? 'checking' : authenticated || guestSelected ? 'allowed' : 'login';
export const loginHash = hash => `#/login${hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''}`;
export const resumeHash = (hash, saved) => saved || `#/library${hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''}`;
