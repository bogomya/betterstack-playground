/** Better Stack JS tag loader (RUM + frontend errors), rendered inline in <head>. */
export default function BetterStackTag({ token, environment, release }: { token: string; environment: string; release: string }) {
  const snippet = `
!function(b,e,t,r){
  b[t]=b[t]||function(...args){(b[t].q=b[t].q||[]).push(args)};
  b[t].l=+new Date;
  var s=e.createElement('script'); s.async=1; s.crossOrigin='anonymous';
  s.src='https://betterstack.net/b.js?t='+r;
  (e.head||e.getElementsByTagName('head')[0]).appendChild(s);
}(window,document,'betterstack',${JSON.stringify(token)});
betterstack('init', { environment: ${JSON.stringify(environment)}, release: ${JSON.stringify(release)} });
`;
  return <script dangerouslySetInnerHTML={{ __html: snippet }} />;
}
