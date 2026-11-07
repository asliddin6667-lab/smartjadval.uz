// Qalam va chelak — HAMMA qurilmada bir xil ko'rinadigan SVG ikonkalar.
//
// ⚠️ Bu joyda emoji ishlatmang: emoji'ni operatsion tizim chizadi, shuning
// uchun Windows, Mac va telefonda rangi ham, shakli ham har xil chiqadi.
// Rang `currentColor` dan olinadi, ya'ni tugmaning `color` xususiyatidan.

function svgProps(size) {
  return {
    className: "ui-icon",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
  };
}

export function IconEdit({ size = 16 }) {
  return (
    <svg {...svgProps(size)}>
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function IconTrash({ size = 16 }) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
