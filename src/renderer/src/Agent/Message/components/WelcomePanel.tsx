import { memo } from 'react';

const WelcomePanel = () => {
  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#f4f4f4] text-2xl text-[#1f2328]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-8 w-8"
        >
          <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
          <path d="M12 12 2.1 7.1" />
          <path d="M12 12l9.9 4.9" />
        </svg>
      </div>
      <h1 className="text-center text-2xl font-medium text-[#1f2328]">
        有什么我可以帮您的？
      </h1>
    </section>
  );
};

export default memo(WelcomePanel);
