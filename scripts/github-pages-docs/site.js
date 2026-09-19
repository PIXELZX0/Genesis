(() => {
  const root = document.documentElement;
  document.querySelector(".theme-btn")?.addEventListener("click", () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("genesis-theme", next);
    } catch {}
  });

  const menu = document.querySelector(".menu-btn");
  menu?.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    menu.setAttribute("aria-expanded", String(open));
  });

  document.querySelector(".sidebar .active")?.scrollIntoView({ block: "center" });

  for (const pre of document.querySelectorAll(".prose pre")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-btn";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? "");
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy"), 1500);
      } catch {}
    });
    pre.append(button);
  }

  const links = [...document.querySelectorAll(".toc a")];
  const targets = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter(Boolean);
  if (targets.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) {
          return;
        }
        for (const link of links) {
          link.classList.toggle("active", link.hash === `#${visible.target.id}`);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
  }
})();
