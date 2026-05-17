export const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateShort = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const fmtDateTime = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtWeekdayTime = (d) =>
  new Date(d).toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export const fmtWeekdayLong = (d) =>
  new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
