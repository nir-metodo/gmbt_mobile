/** Personal signing link: appends the sharing user's id (?by=) so the sender is notified when the customer signs. */
export function withSharer(url: string, user: any): string {
  const uid = user?.uID || user?.userId;
  if (!url || !uid || /[?&]by=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'by=' + encodeURIComponent(uid);
}
