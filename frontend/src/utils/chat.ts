export const chatDate = (iso: string) => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`);
export const initials = (name: string) => name.replace(/_/g, ' ').split(/\s+/).filter(Boolean).slice(0,2).map(s => s[0]).join('').toUpperCase();
