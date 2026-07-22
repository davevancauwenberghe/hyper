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
  let activeIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));

  const showStory = nextIndex => {
    activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => slide.classList.toggle('is-active', index === activeIndex));
    dots.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === activeIndex);
      if (index === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  carousel.querySelector('[data-daily-prev]')?.addEventListener('click', () => showStory(activeIndex - 1));
  carousel.querySelector('[data-daily-next]')?.addEventListener('click', () => showStory(activeIndex + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => showStory(index)));
}
