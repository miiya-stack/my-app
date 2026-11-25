(() => {
  const root = document.documentElement;
  root.classList.add('js');

  // Header shadow + back-to-top
  const header = document.querySelector('.hdr, .header');
  const totop = document.querySelector('.totop');
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    if (totop) totop.classList.toggle('is-show', y > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Mobile menu
  const burger = document.getElementById('burger');
  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
  };
  burger.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
  document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  // Scroll reveal
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
  items.forEach((el) => io.observe(el));
})();
