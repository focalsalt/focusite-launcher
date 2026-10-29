import React, { useState } from "react";

interface PlayerAvatarProps {
  username: string;
  size?: number;
  className?: string;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  username,
  size = 32,
  className = "",
}) => {
  const [loadError, setLoadError] = useState(false);
  const avatarUrl = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`;

  if (loadError || !username || username === "未登入帳號") {
    return (
      <div
        className={`flex items-center justify-center rounded-md bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] font-bold text-white shadow-sm shrink-0 select-none ${className}`}
        style={{ width: size, height: size, fontSize: size <= 16 ? "8px" : size <= 24 ? "10px" : "12px" }}
      >
        {username ? username.slice(0, 1).toUpperCase() : "?"}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-md bg-slate-800 shadow-sm shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={avatarUrl}
        alt={username}
        className="h-full w-full object-cover"
        onError={() => setLoadError(true)}
      />
    </div>
  );
};
