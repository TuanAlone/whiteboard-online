import React, { useState, useEffect } from 'react';
import type { Project } from '../types';
import { TrashIcon, XIcon } from './icons';

interface ProjectsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (id: string, newName: string) => void;
}

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onDeleteProject,
  onRenameProject,
}) => {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Reset editing state when panel is closed
  useEffect(() => {
    if (!isOpen) {
      setEditingProjectId(null);
    }
  }, [isOpen]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if(window.confirm('Are you sure you want to delete this drawing?')) {
        onDeleteProject(id);
    }
  }

  const handleStartEditing = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingProjectId(project.id);
    setEditingName(project.name);
  };

  const handleSaveRename = () => {
    if (editingProjectId && editingName.trim()) {
      const project = projects.find(p => p.id === editingProjectId);
      if (project && project.name !== editingName.trim()) {
        onRenameProject(editingProjectId, editingName.trim());
      }
    }
    setEditingProjectId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditingProjectId(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-30 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      />
      {/* Panel */}
      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[90vw] bg-gray-50 shadow-2xl z-40 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-bold text-gray-800">My Drawings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-200 transition-colors"
            title="Close panel"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto h-[calc(100vh-65px)]">
          {projects.length === 0 ? (
            <p className="text-center text-gray-500 mt-8">No drawings yet. Create a new one!</p>
          ) : (
            projects.map(project => (
              <div
                key={project.id}
                onClick={() => editingProjectId !== project.id && onSelectProject(project.id)}
                className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-all duration-200 ${
                  project.id === currentProjectId
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'bg-white text-gray-800 hover:bg-blue-50 hover:shadow-sm border'
                }`}
              >
                <div className="w-20 h-16 bg-white rounded-md flex-shrink-0 overflow-hidden border">
                    {project.images && project.images.length > 0 ? (
                        <img src={project.images[project.images.length - 1].dataUrl} alt={project.name} className="w-full h-full object-cover" />
                    ) : (
                       <div className="w-full h-full bg-gray-100"></div>
                    )}
                </div>
                <div className="flex-grow overflow-hidden" onDoubleClick={(e) => handleStartEditing(e, project)}>
                   {editingProjectId === project.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={handleSaveRename}
                      onKeyDown={handleKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold w-full bg-transparent border-b-2 border-blue-300 outline-none px-1"
                      autoFocus
                    />
                  ) : (
                    <p className="font-semibold truncate" title="Double-click to rename">{project.name}</p>
                  )}
                </div>
                <button
                  onClick={(e) => handleDelete(e, project.id)}
                  className={`p-2 rounded-full flex-shrink-0 ${
                    project.id === currentProjectId 
                    ? 'hover:bg-blue-600' 
                    : 'text-gray-400 hover:bg-red-100 hover:text-red-600'
                  }`}
                  title="Delete drawing"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
};