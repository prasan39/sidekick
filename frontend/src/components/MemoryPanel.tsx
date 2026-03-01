import { useState, useEffect } from 'react';

interface MemoryPanelProps {
  memory: string;
  onUpdate: (content: string) => Promise<{ success: boolean; message: string }>;
  onRefresh: () => void;
}

export function MemoryPanel({ memory, onUpdate, onRefresh }: MemoryPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditContent(memory);
  }, [memory]);

  const handleSave = async () => {
    setIsSaving(true);
    const result = await onUpdate(editContent);
    setIsSaving(false);

    if (result.success) {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditContent(memory);
    setIsEditing(false);
  };

  return (
    <div className="memory-panel">
      <div className="memory-header">
        <h3>Memory</h3>
        <div className="memory-actions">
          {isEditing ? (
            <>
              <button
                className="btn btn-small"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-small btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-small" onClick={() => setIsEditing(true)}>
                Edit
              </button>
              <button className="btn btn-small btn-secondary" onClick={onRefresh}>
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      <div className="memory-content">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="memory-editor"
            placeholder="Enter memory content..."
          />
        ) : (
          <pre className="memory-display">{memory || 'No memory stored yet.'}</pre>
        )}
      </div>
    </div>
  );
}
