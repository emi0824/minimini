export const formatMonthDay = (date?: string): string => {
  const match = String(date || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[1])}月${Number(match[2])}日`;
};
