const root = document.documentElement;
const saved = localStorage.getItem('theme');
if (saved) root.dataset.theme = saved;
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('theme', next);
});

for (const carousel of document.querySelectorAll('[data-daily-stories]')) {
  const slides = [...carousel.querySelectorAll('.daily-story-slide')];
  const dots = [...carousel.querySelectorAll('.daily-story-dot')];
  if (slides.length < 2) continue;

  let activeIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));
  let rotationTimer;

  const showStory = nextIndex => {
    activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => slide.classList.toggle('is-active', index === activeIndex));
    dots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === activeIndex);
      if (index === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  const startRotation = () => {
    window.clearInterval(rotationTimer);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rotationTimer = window.setInterval(() => showStory(activeIndex + 1), 5500);
  };

  const resetRotation = () => {
    startRotation();
  };

  dots.forEach((dot, index) => dot.addEventListener('click', () => {
    showStory(index);
    resetRotation();
  }));

  carousel.addEventListener('mouseenter', () => window.clearInterval(rotationTimer));
  carousel.addEventListener('mouseleave', startRotation);
  carousel.addEventListener('focusin', () => window.clearInterval(rotationTimer));
  carousel.addEventListener('focusout', startRotation);

  startRotation();
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
