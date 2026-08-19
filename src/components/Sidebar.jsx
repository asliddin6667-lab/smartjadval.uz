import { useState } from "react";

/* Chiziqli (stroke) SVG ikonkalar — ikkinchi dizayn varianti */
const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.9",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const ICONS = {
  dashboard: (
    <svg {...svgProps}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  classes: (
    <svg {...svgProps}>
      <path d="M22 10 12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  ),
  subjects: (
    <svg {...svgProps}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  teachers: (
    <svg {...svgProps}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  teacherAvailability: (
    <svg {...svgProps}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  classSubjects: (
    <svg {...svgProps}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
  rooms: (
    <svg {...svgProps}>
      <path d="M13 4h3a2 2 0 0 1 2 2v14" />
      <path d="M2 20h11" />
      <path d="M13 20h9" />
      <path d="M10 12v.01" />
      <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.562z" />
    </svg>
  ),
  timeslots: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  lunchGroups: (
    <svg {...svgProps}>
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="6" x2="6" y1="2" y2="4" />
      <line x1="10" x2="10" y1="2" y2="4" />
      <line x1="14" x2="14" y1="2" y2="4" />
    </svg>
  ),
  schedule: (
    <svg {...svgProps}>
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  ),
  teacherReplace: (
    <svg {...svgProps}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  ),
  analytics: (
    <svg {...svgProps}>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  importExport: (
    <svg {...svgProps}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  ),
  standardHours: (
    <svg {...svgProps}>
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M16 3h5v5" />
      <path d="M9 15h4" />
      <path d="M9 11h7" />
      <path d="m14 9 7-6" />
    </svg>
  ),
  users: (
    <svg {...svgProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  settings: (
    <svg {...svgProps}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  logout: (
    <svg {...svgProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  ),
  collapse: (
    <svg {...svgProps}>
      <path d="m11 17-5-5 5-5" />
      <path d="m18 17-5-5 5-5" />
    </svg>
  ),
  expand: (
    <svg {...svgProps}>
      <path d="m6 17 5-5-5-5" />
      <path d="m13 17 5-5-5-5" />
    </svg>
  ),
};

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "classes", label: "Sinflar" },
  { id: "subjects", label: "Fanlar" },
  { id: "teachers", label: "O'qituvchilar" },
  { id: "teacherAvailability", label: "Ustoz setkasi" },
  { id: "classSubjects", label: "Sinf fanlari" },
  { id: "rooms", label: "Xonalar" },
  { id: "timeslots", label: "Dars vaqtlari" },
  { id: "lunchGroups", label: "Dam olish vaqtlari" },
  { id: "schedule", label: "Dars jadvali" },
  { id: "teacherReplace", label: "Ustoz almashtirish" },
  { id: "analytics", label: "Jadval tahlili" },
  { id: "importExport", label: "Excel" },
  { id: "users", label: "Foydalanuvchilar", superOnly: true },
  { id: "standardHours", label: "Standart soatlar", superOnly: true },
  { id: "settings", label: "Sozlamalar" },
];

function getInitials(name) {
  if (!name) return "F";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function Sidebar({
  activePage,
  setActivePage,
  schoolName,
  currentUser,
  onLogout,
  darkMode,
  setDarkMode,
  mobileOpen = false,
  onCloseMobile,
}) {
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.superOnly || currentUser?.role === "superadmin"
  );

  const renderItem = (item) => (
    <button
      key={item.id}
      type="button"
      onClick={() => setActivePage(item.id)}
      className={`nav-item ${activePage === item.id ? "active" : ""}`}
      title={item.label}
    >
      <span className="nav-icon" aria-hidden="true">{ICONS[item.id]}</span>
      <span className="nav-label">{item.label}</span>
    </button>
  );

  return (
    <aside
      className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      <div className="sidebar-logo sidebar-logo-image">
        {/* Faqat kichik ekranlarda ko'rinadi (CSS: .sidebar-close) */}
        <button
          type="button"
          className="sidebar-close"
          onClick={() => onCloseMobile?.()}
          aria-label="Menyuni yopish"
          title="Yopish"
        >
          ✕
        </button>

        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="smartjadval.uz"
          className="sidebar-brand-img"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <div className="sidebar-brand-fallback">smartjadval<span>.uz</span></div>
        <div className="sidebar-school-name">
          {schoolName || currentUser?.schoolName || "Maktab platformasi"}
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Menyuni ochish" : "Menyuni yig'ish"}
        >
          <span className="sidebar-toggle-icon">
            {collapsed ? ICONS.expand : ICONS.collapse}
          </span>
          <span className="sidebar-toggle-label">Yig'ish</span>
        </button>

        {!collapsed ? (
          <div className="nav-section-row">
            <div className="nav-section-title">Asosiy</div>
            <button
              className={`theme-switch ${darkMode ? "night" : ""}`}
              type="button"
              onClick={() => setDarkMode?.(!darkMode)}
              title={darkMode ? "Kunduzgi rejim" : "Tungi rejim"}
            >
              <span className="theme-switch-star s1" />
              <span className="theme-switch-star s2" />
              <span className="theme-switch-star s3" />
              <span className="theme-switch-knob">{darkMode ? "🌙" : "☀️"}</span>
            </button>
          </div>
        ) : (
          <button
            className={`theme-switch collapsed ${darkMode ? "night" : ""}`}
            type="button"
            onClick={() => setDarkMode?.(!darkMode)}
            title={darkMode ? "Kunduzgi rejim" : "Tungi rejim"}
          >
            <span className="theme-switch-knob">{darkMode ? "🌙" : "☀️"}</span>
          </button>
        )}
        {visibleItems.filter((i) => ["dashboard"].includes(i.id)).map(renderItem)}

        {!collapsed && <div className="nav-section-title">Ma'lumotlar</div>}
        {visibleItems
          .filter((i) =>
            [
              "classes",
              "subjects",
              "teachers",
              "teacherAvailability",
              "classSubjects",
              "rooms",
              "timeslots",
              "lunchGroups",
            ].includes(i.id)
          )
          .map(renderItem)}

        {!collapsed && <div className="nav-section-title">Jadval</div>}
        {visibleItems
          .filter((i) => ["schedule", "teacherReplace", "analytics", "importExport"].includes(i.id))
          .map(renderItem)}

        {!collapsed && <div className="nav-section-title">Tizim</div>}
        {visibleItems
          .filter((i) => ["users", "standardHours", "settings"].includes(i.id))
          .map(renderItem)}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-profile-card">
          <div className="sidebar-profile-top">
            <div className="sidebar-avatar">
              {getInitials(currentUser?.name)}
            </div>
            <div className="sidebar-profile-info">
              <div className="sidebar-user-name">{currentUser?.name || "Foydalanuvchi"}</div>
              <div className="sidebar-user-role">
                {currentUser?.role === "superadmin" ? "Super Admin" : "Foydalanuvchi"}
              </div>
            </div>
          </div>

          <button className="sidebar-logout" type="button" onClick={onLogout} title="Chiqish">
            <span className="sidebar-logout-icon" aria-hidden="true">{ICONS.logout}</span>
            <span className="sidebar-logout-text">Chiqish</span>
          </button>
        </div>

        <div className="sidebar-version">v2.0 · By Turon maktab </div>
      </div>
    </aside>
  );
}
