// Shared UI components and utilities for Lean SaaS Starter

// Basic UI exports placeholder
export const Button = () => null;
export const Card = () => null;
export const Modal = () => null;

// Component types
export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export * from './components'
export * from './lib/utils'