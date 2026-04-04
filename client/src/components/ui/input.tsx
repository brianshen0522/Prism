import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900',
        'placeholder-gray-400 shadow-sm',
        'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
        'disabled:bg-gray-50 disabled:text-gray-500',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500',
        'dark:focus:border-blue-400 dark:focus:ring-blue-400',
        'dark:disabled:bg-gray-700 dark:disabled:text-gray-400',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
