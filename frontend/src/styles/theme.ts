export const theme = {
  colors: {
    brand: {
      solid: "bg-violet-600",
      solidHover: "hover:bg-violet-700",
      text: "text-violet-700",
      softText: "text-violet-600",
      softBg: "bg-violet-50",
      border: "border-violet-500",
      softBorder: "border-violet-100",
      ring: "focus-within:ring-violet-500/10",
      shadow: "shadow-violet-600/20",
    },

    neutral: {
      page: "bg-white",
      subtlePage: "bg-slate-50",
      text: "text-slate-950",
      mutedText: "text-slate-500",
      secondaryText: "text-slate-600",
      border: "border-slate-200",
      softBorder: "border-slate-200/80",
      dark: "bg-slate-950",
      darkHover: "hover:bg-slate-800",
    },

    danger: {
      text: "text-rose-700",
      softBg: "hover:bg-rose-50",
    },
  },

  header: {
    shell:
      "sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl transition-shadow duration-200 supports-[backdrop-filter]:bg-white/80 dark:border-slate-800 dark:bg-slate-950/90 dark:supports-[backdrop-filter]:bg-slate-950/80",

    container:
      "flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8",

    leftCluster: "flex min-w-0 items-center gap-4 md:gap-8",

    logoMark:
      "flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-sm font-bold tracking-[0.12em] text-white shadow-sm shadow-violet-600/20 transition duration-200 group-hover:scale-105 group-hover:shadow-md group-hover:shadow-violet-600/25",

    desktopNav: "hidden shrink-0 items-center gap-1 md:flex",

    navLink:
      "relative rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition duration-200 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white",

    navLinkActive:
      "relative rounded-md px-3 py-2 text-sm font-semibold text-violet-700 after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-violet-600 dark:text-violet-300 dark:after:bg-violet-400",

    searchForm: "hidden min-w-0 lg:flex lg:w-[20rem] xl:w-[24rem]",

    searchWrapper:
      "group flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 transition duration-200 focus-within:border-violet-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-violet-400 dark:focus-within:bg-slate-900",

    mobileSearchPanel:
      "border-t border-slate-200 bg-white px-4 py-3 sm:px-6 lg:hidden dark:border-slate-800 dark:bg-slate-950",

    mobileSearchWrapper:
      "group flex h-11 w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 transition duration-200 focus-within:border-violet-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-violet-400 dark:focus-within:bg-slate-900",

    searchIcon:
      "text-slate-400 transition duration-200 group-focus-within:text-violet-600 dark:text-slate-500 dark:group-focus-within:text-violet-400",

    searchInput:
      "min-w-0 flex-1 bg-transparent text-[14px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",

    searchKbd:
      "shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",

    searchSubmit:
      "shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:bg-violet-700",

    rightCluster: "flex shrink-0 items-center gap-1.5 md:gap-2",

    iconButton:
      "flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-slate-700 transition duration-200 hover:bg-slate-100 active:scale-95 dark:text-slate-200 dark:hover:bg-slate-800",

    mobileDropdown:
      "fixed left-0 right-0 top-16 z-50 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-slate-200 bg-white shadow-xl shadow-slate-950/10 animate-mobile-dropdown-in dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/40",

    // max-h/overflow keep the panel reachable on short viewports (landscape
    // phones) instead of running off the bottom with no way to scroll.
    dropdown:
      "absolute right-0 top-[calc(100%+0.5rem)] w-72 max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10 animate-dropdown-in dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/40",

    dropdownHighlight:
      "rounded-xl border border-violet-100 bg-violet-50 p-3 dark:border-violet-900/50 dark:bg-violet-950/40",

    dropdownItem:
      "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-950 transition duration-200 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800",

    dropdownItemIcon: "h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500",

    dropdownDivider: "my-2 h-px bg-slate-200 dark:bg-slate-800",

    dropdownThemeRow:
      "flex items-center justify-between rounded-xl px-3 py-1.5 text-sm font-medium text-slate-950 dark:text-white",

    logoutButton:
      "w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-700 transition duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-400 dark:hover:bg-rose-950/40",

    mobileNavLink:
      "rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition duration-200 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",

    mobileNavLinkActive:
      "rounded-xl bg-violet-50 px-3 py-2.5 text-sm font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",

    mobileCta:
      "group flex items-center justify-between rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:bg-violet-700",

    desktopAccountTrigger:
      "flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full transition duration-200 hover:ring-4 hover:ring-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200 dark:hover:ring-slate-800 dark:focus-visible:ring-violet-500/40",

    avatarSkeleton:
      "h-9 w-9 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800",

    authLinkPrimary:
      "rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200",
  },

  // App-shell sidebar. Rendered only on authenticated workspace routes: a
  // horizontal scroll strip below `lg`, a sticky vertical rail at `lg` and up.
  sidebar: {
    // `lg:items-start` keeps the rail from stretching, which `lg:sticky` needs.
    layout: "flex min-h-full flex-col lg:flex-row lg:items-start",

    content: "min-w-0 flex-1",

    // The sticky offset tracks the real header height rather than assuming
    // 4rem: opening the mobile search panel grows the header, and a hard-coded
    // offset would let it cover the strip. SiteHeader keeps the property in
    // sync; the fallback matches the collapsed header.
    shell:
      "w-full shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur sticky top-[var(--app-header-offset,4rem)] z-30 lg:z-auto lg:h-[calc(100vh-var(--app-header-offset,4rem))] lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6 dark:border-slate-800 dark:bg-slate-950/90",

    strip:
      "flex gap-2 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",

    // `contents` flattens groups into the single mobile scroller; at `lg` they
    // become stacked, labelled blocks.
    group: "contents lg:block",

    groupList: "contents lg:flex lg:flex-col lg:gap-0.5",

    groupLabel:
      "sr-only lg:not-sr-only lg:block lg:px-3 lg:pt-4 lg:pb-1 lg:text-[11px] lg:font-semibold lg:uppercase lg:tracking-[0.18em] lg:text-slate-400 dark:lg:text-slate-500",

    item: "flex min-w-[11rem] shrink-0 items-center gap-3 rounded-[1.1rem] px-3 py-2.5 text-sm font-medium text-slate-600 transition duration-200 hover:bg-slate-100 hover:text-slate-950 lg:min-w-0 lg:shrink dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white",

    itemActive:
      "flex min-w-[11rem] shrink-0 items-center gap-3 rounded-[1.1rem] bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white shadow-[0_16px_40px_-26px_rgba(15,23,42,0.75)] lg:min-w-0 lg:shrink dark:bg-white dark:text-slate-950",

    itemIcon: "h-5 w-5 shrink-0 text-slate-400 dark:text-slate-500",

    itemIconActive: "h-5 w-5 shrink-0 text-white dark:text-slate-950",

    subList:
      "mt-1 flex gap-2 overflow-x-auto lg:ml-4 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-l lg:border-slate-200 lg:pl-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:lg:border-slate-800",

    subItem:
      "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-600 transition duration-200 hover:bg-slate-100 hover:text-slate-950 lg:shrink dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white",

    subItemActive:
      "flex shrink-0 items-center gap-2.5 rounded-xl bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 lg:shrink dark:bg-violet-950/40 dark:text-violet-300",

    skeletonItem:
      "h-10 w-40 shrink-0 animate-pulse rounded-[1.1rem] bg-slate-200/70 lg:w-full dark:bg-slate-800/70",

    skeletonSubItem:
      "h-10 w-32 shrink-0 animate-pulse rounded-xl bg-slate-200/70 lg:w-full dark:bg-slate-800/70",
  },

  footer: {
    shell:
      "border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950",

    container: "mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-16",

    topGrid:
      "grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-12",

    linkGroupsWrapper:
      "grid grid-cols-2 gap-8 sm:col-span-2 sm:grid-cols-3 lg:col-span-3",

    brandTagline:
      "mt-5 max-w-sm text-sm leading-7 text-slate-600 dark:text-slate-400",

    sectionTitle:
      "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400",

    linkList: "mt-5 grid gap-3",

    link: "text-sm text-slate-700 transition duration-200 hover:text-violet-700 dark:text-slate-300 dark:hover:text-violet-300",

    socialRow: "mt-6 flex items-center gap-2",

    socialLink:
      "flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-violet-900/60 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    metaBar:
      "mt-12 flex flex-col gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:text-slate-400",
  },

  auth: {
    page: "relative overflow-hidden bg-slate-50 dark:bg-slate-950",

    background:
      "absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.12),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(99,102,241,0.10),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_20%_15%,rgba(124,58,237,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(59,130,246,0.14),transparent_26%),linear-gradient(180deg,#020617_0%,#0b1120_100%)]",

    orbPrimary:
      "absolute -left-20 top-10 h-72 w-72 rounded-full bg-violet-200/45 blur-3xl dark:bg-violet-500/10",
    orbSecondary:
      "absolute -right-20 top-24 h-80 w-80 rounded-full bg-indigo-200/35 blur-3xl dark:bg-indigo-500/10",
    orbAccent:
      "absolute bottom-[-8rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/25 blur-3xl dark:bg-sky-500/10",

    container:
      "relative mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)] lg:items-start lg:px-8 lg:py-20",

    heroColumn: "order-2 max-w-3xl lg:order-1 lg:pt-6",
    formColumn: "order-1 lg:order-2 lg:sticky lg:top-24",

    eyebrow:
      "inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300",

    title:
      "mt-6 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-slate-950 sm:text-5xl lg:text-6xl dark:text-white",

    description:
      "mt-5 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg dark:text-slate-300",

    linkRow: "mt-8 flex flex-wrap items-center gap-3",

    utilityLink:
      "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    textLink:
      "text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200",

    featureGrid: "mt-10 grid gap-4 sm:grid-cols-3",

    featureCard:
      "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-violet-200 hover:shadow-xl hover:shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-800 dark:hover:shadow-black/40",

    featureIcon:
      "flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    featureTitle:
      "mt-4 text-base font-semibold tracking-[-0.02em] text-slate-950 dark:text-white",
    featureDescription:
      "mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300",

    spotlight:
      "mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40",

    spotlightLabel:
      "text-sm font-semibold text-violet-700 dark:text-violet-300",
    spotlightTitle:
      "mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white",
    spotlightDescription:
      "mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300",
    spotlightList: "mt-5 grid gap-3",
    spotlightItem:
      "flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200",

    card: "rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.35)] sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_24px_80px_-40px_rgba(0,0,0,0.7)]",

    cardEyebrow: "text-sm font-medium text-violet-700 dark:text-violet-300",
    cardTitle:
      "mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-[2.1rem] dark:text-white",
    cardDescription:
      "mt-3 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300",

    dividerLine: "h-px flex-1 bg-slate-200 dark:bg-slate-800",
    dividerText:
      "text-xs font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500",

    fieldGroup:
      "rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-950/40",
    fieldSectionLabel:
      "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400",
    fieldSectionDescription: "mt-1 text-sm text-slate-600 dark:text-slate-300",

    fieldLabel: "text-sm font-medium text-slate-700 dark:text-slate-200",
    fieldShell:
      "relative rounded-2xl border bg-white transition duration-200 dark:bg-slate-900",
    fieldDefault:
      "border-slate-200 hover:border-violet-200 dark:border-slate-700 dark:hover:border-violet-800",
    fieldActive:
      "border-violet-300 ring-4 ring-violet-100 dark:border-violet-500 dark:ring-violet-500/20",
    fieldError:
      "border-rose-300 ring-4 ring-rose-100 dark:border-rose-500 dark:ring-rose-500/20",
    fieldIcon:
      "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-violet-600 dark:text-violet-400",
    fieldInput:
      "h-14 w-full rounded-2xl bg-transparent pl-12 pr-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",
    fieldInputWithAction:
      "h-14 w-full rounded-2xl bg-transparent pl-12 pr-14 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",
    fieldText: "text-sm text-slate-500 dark:text-slate-400",
    fieldErrorText: "text-sm text-rose-700 dark:text-rose-300",

    iconButton:
      "absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-500 transition duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-slate-600",

    primaryButton:
      "inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-2xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0",

    secondaryButton:
      "inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-900 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50/70 disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-violet-800 dark:hover:bg-violet-950/40",

    tertiaryLink:
      "inline-flex h-12 w-full items-center justify-center text-sm font-medium text-violet-700 transition duration-200 hover:text-violet-800 dark:text-violet-300 dark:hover:text-violet-200",

    oauthButton:
      "inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:focus:ring-violet-500/20",

    captchaPanel:
      "rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/40",

    successPanel:
      "rounded-3xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
    infoPanel:
      "rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
    warningPanel:
      "rounded-3xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
    errorPanel:
      "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200",
  },

  marketplace: {
    page: "relative overflow-hidden bg-slate-50 dark:bg-slate-950",

    background:
      "absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(124,58,237,0.12),transparent_26%),radial-gradient(circle_at_82%_16%,rgba(99,102,241,0.10),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_18%_12%,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(59,130,246,0.14),transparent_26%),linear-gradient(180deg,#020617_0%,#0b1120_100%)]",

    orbPrimary:
      "absolute -left-24 top-10 h-80 w-80 rounded-full bg-violet-200/35 blur-3xl dark:bg-violet-500/10",
    orbSecondary:
      "absolute -right-20 top-20 h-80 w-80 rounded-full bg-indigo-200/25 blur-3xl dark:bg-indigo-500/10",

    container: "relative mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8",

    heroShell:
      "overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40",

    heroHeader:
      "border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.10),transparent_28%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 sm:p-8 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_28%),linear-gradient(180deg,#0f172a_0%,#020617_100%)]",

    heroGrid: "grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start",

    eyebrow:
      "inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 shadow-sm dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300",

    title:
      "mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.055em] text-slate-950 sm:text-5xl dark:text-white",

    description:
      "mt-4 max-w-2xl text-base leading-8 text-slate-600 dark:text-slate-300",

    utilityList: "grid gap-3",
    utilityCard:
      "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90",
    utilityLabel: "text-sm font-semibold text-slate-950 dark:text-white",
    utilityDescription:
      "mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300",

    searchBody: "p-6 sm:p-8",

    primarySearchShell:
      "rounded-[1.75rem] border border-slate-200 bg-slate-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40",

    primarySearchGrid: "grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]",

    primaryInputWrap:
      "group flex h-14 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 transition duration-200 focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-violet-400 dark:focus-within:ring-violet-500/20",

    primaryInputIcon:
      "text-slate-400 transition duration-200 group-focus-within:text-violet-600 dark:text-slate-500 dark:group-focus-within:text-violet-400",

    primaryInput:
      "min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500",

    autocompleteDropdown:
      "absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40",

    autocompleteOption:
      "w-full px-4 py-3 text-left text-sm text-slate-700 transition duration-150 hover:bg-violet-50 hover:text-violet-700 dark:text-slate-200 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    autocompleteOptionActive:
      "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",

    autocompleteLoading: "px-4 py-3 text-sm text-slate-500 dark:text-slate-400",

    primaryButton:
      "inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-violet-600 px-6 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md hover:shadow-violet-600/25",

    chip: "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    chipActive:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",

    summary:
      "flex flex-wrap items-center gap-2 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900",

    summaryEmpty:
      "rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",

    summaryPill:
      "rounded-full border border-violet-100 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-violet-900/50 dark:bg-slate-900 dark:text-slate-300",

    input:
      "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition duration-200 placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20",

    fieldLabel:
      "text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400",
    fieldHint: "text-xs text-slate-400 dark:text-slate-500",

    advancedShell:
      "group rounded-[1.75rem] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900",

    advancedSummary:
      "flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-5",

    advancedToggle:
      "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",

    filterPanel:
      "rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40",

    resultsShell:
      "mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40",

    resultsMeta:
      "flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500 dark:text-slate-400",

    resultsEmpty:
      "mt-6 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",

    resultCard:
      "group overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white transition duration-200 hover:-translate-y-1 hover:border-violet-200 hover:shadow-xl hover:shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-800 dark:hover:shadow-black/40",

    // Save toggle. Each state is a complete standalone class string rather
    // than a base plus modifiers, matching the convention used elsewhere in
    // this file for variant-dependent styling.
    saveButton:
      "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition duration-200 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300",

    saveButtonActive:
      "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition duration-200 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60",

    saveButtonDisabled:
      "inline-flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300 transition duration-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600",

    saveButtonLabelled:
      "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition duration-200 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300",

    saveButtonLabelledActive:
      "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-600 transition duration-200 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/60",

    saveButtonLabelledDisabled:
      "inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-300 transition duration-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600",

    resultFallback:
      "absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.18),transparent_28%),linear-gradient(135deg,#f8fafc,#ede9fe_55%,#ffffff)] text-xs font-semibold uppercase tracking-[0.24em] text-violet-700/70 dark:bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.28),transparent_30%),linear-gradient(135deg,#0f172a,#1e1b4b_55%,#020617)] dark:text-violet-300/70",

    metaBadge:
      "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",

    paginationButton:
      "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    paginationButtonDisabled:
      "rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600",
  },

  // Shared pagination control (src/components/common/pagination). Top-level
  // rather than nested under `marketplace` because most call sites are
  // dashboards. Note the `marketplace.paginationButton` tokens above are a
  // generic secondary-button style used at several non-pagination call sites,
  // so they are deliberately not reused here.
  pagination: {
    container:
      "mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800",

    containerBare:
      "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",

    summary: "text-sm text-slate-500 dark:text-slate-400",

    nav: "flex flex-col items-center gap-2 sm:flex-row",

    list: "flex items-center gap-1",

    numbersOnly: "hidden sm:flex",

    compactStatus: "text-sm text-slate-500 sm:hidden dark:text-slate-400",

    extras: "flex flex-wrap items-center justify-center gap-3 sm:justify-end",

    // The disabled variants are complete standalone strings, not modifiers
    // appended to the enabled ones. There is no clsx/tailwind-merge here and
    // Tailwind precedence follows stylesheet order, not class order.
    page: "inline-flex h-9 min-w-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition duration-200 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    pageActive:
      "inline-flex h-9 min-w-9 items-center justify-center rounded-xl border border-violet-600 bg-violet-600 px-3 text-sm font-semibold text-white shadow-sm shadow-violet-600/20 dark:border-violet-500 dark:bg-violet-600 dark:text-white",

    pageDisabled:
      "inline-flex h-9 min-w-9 cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600",

    iconButton:
      "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition duration-200 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    iconButtonDisabled:
      "inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600",

    ellipsis:
      "inline-flex h-9 min-w-9 select-none items-center justify-center px-1 text-sm text-slate-400 dark:text-slate-500",

    jumpForm: "flex items-center gap-2",

    jumpLabel:
      "sr-only text-xs font-medium text-slate-500 sm:not-sr-only dark:text-slate-400",

    jumpInput:
      "h-9 w-16 rounded-xl border border-slate-200 bg-white px-2 text-center text-sm text-slate-900 outline-none transition duration-200 placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-500/20",

    jumpButton:
      "inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition duration-200 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300",

    sizeLabel: "text-xs font-medium text-slate-500 dark:text-slate-400",

    sizeSelect:
      "h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition duration-200 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-violet-400 dark:focus:ring-violet-500/20",
  },
} as const;
