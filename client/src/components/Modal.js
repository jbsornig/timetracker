import React, { useEffect } from 'react';

export default function Modal({ title, children, onClose, footer, wide }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" style={wide ? { maxWidth: 800 } : undefined}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 20, padding: '4px 8px' }}>
            ×
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
