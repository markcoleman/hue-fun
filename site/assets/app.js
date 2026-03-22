const root = document.documentElement;
const storageKey = 'newhue-pages-theme';
const toggle = document.querySelector('[data-theme-toggle]');
const media = window.matchMedia('(prefers-color-scheme: dark)');

function setTheme(theme) {
  root.dataset.theme = theme;
  window.localStorage.setItem(storageKey, theme);
}

function resolveInitialTheme() {
  const saved = window.localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return media.matches ? 'dark' : 'light';
}

setTheme(resolveInitialTheme());

if (toggle) {
  toggle.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });
}

media.addEventListener('change', (event) => {
  if (!window.localStorage.getItem(storageKey)) {
    setTheme(event.matches ? 'dark' : 'light');
  }
});

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    }
  },
  {
    threshold: 0.16,
  },
);

for (const element of document.querySelectorAll('.reveal')) {
  observer.observe(element);
}
