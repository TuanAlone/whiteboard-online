import React from 'react';
import { XIcon } from './icons';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div 
        className="bg-white rounded-lg shadow-xl p-6 m-4 max-w-sm w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-2 rounded-full text-gray-500 hover:bg-gray-200 transition-colors"
          title="Close"
        >
          <XIcon className="w-6 h-6" />
        </button>
        <h2 className="text-xl font-bold text-gray-800 mb-4">Thông tin</h2>
        <div className="text-gray-700 space-y-2">
          <p><span className="font-semibold">Được thực hiện bởi:</span></p>
          <ul className="list-disc list-inside ml-4">
            <li>Đỗ Khắc Minh Tuấn</li>
            <li>Trần Minh Hải</li>
          </ul>
          <p className="pt-2 italic">Phục vụ cho mục đích học tập.</p>
          <p className="pt-2">Liên hệ chúng tôi qua email: <a href="mailto:minhtuando.1008@gmail.com" className="text-blue-600 hover:underline">minhtuando.1008@gmail.com</a></p>
        </div>
      </div>
    </div>
  );
};