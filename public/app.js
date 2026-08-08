const root = document.documentElement;
const themeToggle = document.querySelector('.theme-toggle');
const themeIcon = document.querySelector('[data-theme-icon]');
const savedTheme = localStorage.getItem('theme');
root.dataset.theme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

const syncThemeControl = () => {
  const isDark = root.dataset.theme === 'dark';
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeToggle.setAttribute('aria-label', isDark ? 'Licht thema gebruiken' : 'Donker thema gebruiken');
  }
  if (themeIcon) themeIcon.textContent = isDark ? '☀' : '☾';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#1d1916' : '#f7f1e8');
};

syncThemeControl();
themeToggle?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('theme', next);
  syncThemeControl();
});

for (const carousel of document.querySelectorAll('[data-daily-stories]')) {
  const slides = [...carousel.querySelectorAll('.daily-story-slide')];
  const dots = [...carousel.querySelectorAll('.daily-story-dot')];
  const previous = carousel.querySelector('[data-daily-prev]');
  const next = carousel.querySelector('[data-daily-next]');
  if (slides.length < 2) continue;

  let activeIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));

  const showStory = nextIndex => {
    activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const isActive = index === activeIndex;
      slide.classList.toggle('is-active', isActive);
      slide.hidden = !isActive;
      if (isActive) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', 'true');
    });
    dots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === activeIndex);
      if (index === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  dots.forEach((dot, index) => dot.addEventListener('click', () => showStory(index)));
  previous?.addEventListener('click', () => showStory(activeIndex - 1));
  next?.addEventListener('click', () => showStory(activeIndex + 1));
}


const openedPost = document.querySelector('[data-post-id]');
if (openedPost?.dataset.postId) {
  const readUrl = `/posts/${encodeURIComponent(openedPost.dataset.postId)}/read`;
  if (!navigator.sendBeacon?.(readUrl, new Blob([], { type: 'application/x-www-form-urlencoded' }))) {
    fetch(readUrl, { method: 'POST', keepalive: true }).catch(() => {});
  }
}

const dailyStories = document.querySelector('[data-daily-stories]');
if (dailyStories) {
  const scheduleMidnightRefresh = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    window.setTimeout(() => window.location.reload(), nextMidnight.getTime() - now.getTime() + 1000);
  };
  scheduleMidnightRefresh();
}

for (const pageSelect of document.querySelectorAll('[data-page-select]')) {
  pageSelect.addEventListener('change', () => {
    window.location.assign(pageSelect.value);
  });
}

const infoDialog = document.querySelector('[data-info-dialog]');
const openInfoButtons = document.querySelectorAll('[data-info-open]');
const closeInfoButtons = document.querySelectorAll('[data-info-close]');

if (infoDialog) {
  const openInfoDialog = () => {
    if (typeof infoDialog.showModal === 'function') infoDialog.showModal();
    else infoDialog.setAttribute('open', '');
  };
  const closeInfoDialog = () => infoDialog.close?.() || infoDialog.removeAttribute('open');

  openInfoButtons.forEach(button => button.addEventListener('click', openInfoDialog));
  closeInfoButtons.forEach(button => button.addEventListener('click', closeInfoDialog));
  infoDialog.addEventListener('click', event => {
    if (event.target === infoDialog) closeInfoDialog();
  });
}
