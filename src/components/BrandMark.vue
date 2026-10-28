<template>
  <svg
    class="brand-mark"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient
        id="qingyan-island-tile"
        x1="8"
        y1="4"
        x2="56"
        y2="62"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#12271D" />
        <stop offset=".55" stop-color="#091811" />
        <stop offset="1" stop-color="#153428" />
      </linearGradient>
      <radialGradient
        id="qingyan-island-glow"
        cx="31"
        cy="31"
        r="27"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#67C47A" stop-opacity=".36" />
        <stop offset="1" stop-color="#67C47A" stop-opacity="0" />
      </radialGradient>
      <linearGradient
        id="qingyan-island-rim"
        x1="4"
        y1="4"
        x2="60"
        y2="60"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stop-color="#D7EF83" stop-opacity=".72" />
        <stop offset="1" stop-color="#5AB8B0" stop-opacity=".38" />
      </linearGradient>
      <radialGradient id="qingyan-island-window-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#FFE7A3" stop-opacity=".5" />
        <stop offset="1" stop-color="#FFE7A3" stop-opacity="0" />
      </radialGradient>
    </defs>

    <rect width="64" height="64" rx="15" fill="url(#qingyan-island-tile)" />
    <rect width="64" height="64" rx="15" fill="url(#qingyan-island-glow)" />
    <rect
      x="1.6"
      y="1.6"
      width="60.8"
      height="60.8"
      rx="13.6"
      fill="none"
      stroke="url(#qingyan-island-rim)"
      stroke-width="1.6"
    />

    <g transform="translate(8 8) scale(2)" shape-rendering="crispEdges">
      <rect x="12" y="2" width="3" height="1" fill="#F7F0B0" opacity=".7" />
      <rect x="13" y="1" width="1" height="3" fill="#F7F0B0" opacity=".85" />
      <rect x="20" y="3" width="1" height="1" fill="#F7F0B0" opacity=".5" />
      <rect x="3" y="5" width="1" height="1" fill="#F7F0B0" opacity=".4" />
      <rect x="8" y="2" width="1" height="1" fill="#F7F0B0" opacity=".35" />

      <rect x="3" y="12" width="18" height="1" fill="#7A5638" />
      <rect x="3" y="13" width="18" height="1" fill="#5A3E2B" />
      <rect x="4" y="14" width="16" height="1" fill="#2C6B4A" />
      <rect x="4" y="15" width="15" height="1" fill="#1B4A33" />
      <rect x="5" y="16" width="13" height="1" fill="#1B4A33" />
      <rect x="6" y="17" width="11" height="1" fill="#123525" />
      <rect x="8" y="18" width="6" height="1" fill="#123525" />
      <rect x="8" y="19" width="4" height="1" fill="#0C2418" />
      <rect x="9" y="20" width="2" height="1" fill="#0C2418" />
      <rect x="9" y="21" width="1" height="1" fill="#0C2418" />

      <rect x="7" y="15" width="1" height="1" fill="#245C40" />
      <rect x="14" y="15" width="1" height="1" fill="#245C40" />
      <rect x="10" y="16" width="1" height="1" fill="#0F2E1F" />
      <rect x="13" y="17" width="1" height="1" fill="#0F2E1F" />
      <rect x="6" y="15" width="1" height="1" fill="#3D7F5A" />

      <rect x="2" y="10" width="20" height="1" fill="#8FD46A" />
      <rect x="2" y="11" width="20" height="1" fill="#5FAE55" />
      <rect x="3" y="10" width="5" height="1" fill="#B9E880" />
      <rect x="12" y="10" width="5" height="1" fill="#B9E880" />
      <rect x="2" y="10" width="1" height="1" fill="#D7EF83" />
      <rect x="21" y="10" width="1" height="1" fill="#D7EF83" />

      <rect x="18" y="10" width="3" height="1" fill="#67E2D1" />
      <rect x="19" y="11" width="2" height="1" fill="#67E2D1" />
      <rect x="19" y="12" width="2" height="1" fill="#67E2D1" />
      <rect x="19" y="13" width="2" height="1" fill="#2FA9B3" />
      <rect x="19" y="14" width="2" height="1" fill="#67E2D1" />
      <rect x="19" y="15" width="2" height="1" fill="#2FA9B3" />
      <rect x="19" y="16" width="2" height="1" fill="#2FA9B3" />
      <rect x="19" y="17" width="1" height="1" fill="#67E2D1" />
      <rect x="19" y="18" width="1" height="1" fill="#67E2D1" />
      <rect x="20" y="19" width="1" height="1" fill="#2FA9B3" />
      <rect x="19" y="20" width="1" height="1" fill="#2FA9B3" opacity=".6" />

      <rect x="9" y="4" width="1" height="2" fill="#6B4A2A" />
      <rect x="7" y="5" width="2" height="1" fill="#C47A4A" />
      <rect x="6" y="6" width="4" height="1" fill="#C47A4A" />
      <rect x="5" y="7" width="6" height="1" fill="#A85A35" />
      <rect x="6" y="8" width="4" height="2" fill="#F4E8C8" />
      <rect x="7" y="8" width="2" height="1" fill="#FFD77A" />
      <rect x="6" y="9" width="1" height="1" fill="#8A5A35" />
      <rect x="9" y="9" width="1" height="1" fill="#D8C8A8" />
      <rect
        x="5"
        y="7"
        width="8"
        height="6"
        fill="url(#qingyan-island-window-glow)"
        opacity=".7"
      />

      <rect x="16" y="3" width="2" height="1" fill="#E9F9A6" />
      <rect x="15" y="4" width="4" height="1" fill="#B9E66A" />
      <rect x="14" y="5" width="6" height="1" fill="#B9E66A" />
      <rect x="14" y="6" width="6" height="1" fill="#7FBF52" />
      <rect x="15" y="7" width="4" height="1" fill="#5FAE55" />
      <rect x="16" y="8" width="2" height="1" fill="#7FBF52" />
      <rect x="16" y="9" width="2" height="2" fill="#8A5A35" />
      <rect x="16" y="9" width="1" height="1" fill="#B07A4A" />

      <rect x="3" y="8" width="2" height="1" fill="#7FBF52" />
      <rect x="2" y="9" width="4" height="1" fill="#5FAE55" />

      <rect x="2" y="15" width="2" height="1" fill="#8FD46A" />
      <rect x="2" y="16" width="1" height="1" fill="#1B4A33" />
      <rect x="3" y="16" width="1" height="1" fill="#123525" />
      <rect x="21" y="13" width="2" height="1" fill="#8FD46A" />
      <rect x="22" y="14" width="1" height="1" fill="#123525" />
      <rect x="12" y="22" width="1" height="1" fill="#5FAE55" opacity=".7" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
