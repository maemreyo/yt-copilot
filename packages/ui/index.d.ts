// Type definitions for UI package

import * as React from 'react';

export * from './components';

// Basic UI component types
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

// Component declarations
export declare const Button: React.FC<ButtonProps>;
export declare const Card: React.FC<CardProps>;
export declare const Modal: React.FC<ModalProps>;