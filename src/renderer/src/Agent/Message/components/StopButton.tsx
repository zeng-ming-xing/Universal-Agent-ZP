import { memo } from 'react';

interface StopButtonProps {
  onClick?: () => void;
}

const StopButton = ({ onClick }: StopButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium shadow-sm transition"
    >
      <span className="bg-slate-700 inline-block h-2.5 w-2.5 rounded-[3px]" />
      停止
    </button>
  );
};

export default memo(StopButton);
