
/* ====================================
   DASON 2.0 - JAVASCRIPT
==================================== */

// Menú de navegación para móviles

const menuToggle = document.querySelector(".menu-toggle");
const navContent = document.querySelector(".nav-content");

if (menuToggle && navContent) {
  menuToggle.addEventListener("click", () => {
    const isOpen = navContent.classList.toggle("open");

    menuToggle.setAttribute(
      "aria-expanded",
      String(isOpen)
    );

    menuToggle.setAttribute(
      "aria-label",
      isOpen ? "Cerrar menú" : "Abrir menú"
    );

    menuToggle.textContent = isOpen ? "✕" : "☰";
  });
}

const accountLinks = document.querySelectorAll('a[href^="cuenta.html"]');
if (location.protocol === "file:") {
  accountLinks.forEach(link => {
    link.href = "http://127.0.0.1:8765/" + link.getAttribute("href");
  });
}
