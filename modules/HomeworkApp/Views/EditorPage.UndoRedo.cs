using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;

namespace HomeworkApp.Views
{
    public partial class EditorPage
    {
        private const int MaximumHistorySteps = 5;

        private abstract class EditorHistoryEntry
        {
            public abstract void Undo(EditorPage page);
            public abstract void Redo(EditorPage page);
            public virtual bool BelongsTo(InkCanvas canvas) => false;
            public virtual bool ChangesInk => false;
        }

        private sealed class InkHistoryEntry : EditorHistoryEntry
        {
            private readonly InkCanvas _canvas;
            private readonly List<Stroke> _added;
            private readonly List<Stroke> _removed;

            public InkHistoryEntry(InkCanvas canvas, IEnumerable<Stroke> added, IEnumerable<Stroke> removed)
            {
                _canvas = canvas;
                _added = added.ToList();
                _removed = removed.ToList();
            }

            public override void Undo(EditorPage page) => Apply(_added, _removed);
            public override void Redo(EditorPage page) => Apply(_removed, _added);
            public override bool BelongsTo(InkCanvas canvas) => ReferenceEquals(_canvas, canvas);
            public override bool ChangesInk => true;

            private void Apply(IEnumerable<Stroke> remove, IEnumerable<Stroke> add)
            {
                foreach (var stroke in remove.Where(_canvas.Strokes.Contains).ToList())
                {
                    _canvas.Strokes.Remove(stroke);
                }

                foreach (var stroke in add.Where(stroke => !_canvas.Strokes.Contains(stroke)))
                {
                    _canvas.Strokes.Add(stroke);
                }
            }
        }

        private sealed class InkSnapshotHistoryEntry : EditorHistoryEntry
        {
            private readonly InkCanvas _canvas;
            private readonly StrokeCollection _before;
            private readonly StrokeCollection _after;

            public InkSnapshotHistoryEntry(InkCanvas canvas, StrokeCollection before, StrokeCollection after)
            {
                _canvas = canvas;
                _before = before.Clone();
                _after = after.Clone();
            }

            public override void Undo(EditorPage page) => Apply(_before);
            public override void Redo(EditorPage page) => Apply(_after);
            public override bool BelongsTo(InkCanvas canvas) => ReferenceEquals(_canvas, canvas);
            public override bool ChangesInk => true;

            private void Apply(StrokeCollection snapshot)
            {
                _canvas.Strokes.Clear();
                _canvas.Strokes.Add(snapshot.Clone());
            }
        }

        private readonly List<EditorHistoryEntry> _undoHistory = new();
        private readonly List<EditorHistoryEntry> _redoHistory = new();
        private bool _isApplyingEditorHistory;
        private bool _isLoadingInkState;
        private InkCanvas? _selectionHistoryCanvas;
        private StrokeCollection? _selectionHistoryBefore;

        private void RecordInkHistory(InkCanvas canvas, StrokeCollectionChangedEventArgs e)
        {
            if (_isApplyingEditorHistory || _isLoadingInkState)
            {
                return;
            }

            PushHistory(_undoHistory, new InkHistoryEntry(canvas, e.Added, e.Removed));
            _redoHistory.Clear();
        }

        private void BeginSelectionHistory(InkCanvas canvas)
        {
            if (_isApplyingEditorHistory)
            {
                return;
            }

            _selectionHistoryCanvas = canvas;
            _selectionHistoryBefore = canvas.Strokes.Clone();
        }

        private void CompleteSelectionHistory(InkCanvas canvas)
        {
            if (_isApplyingEditorHistory || !ReferenceEquals(_selectionHistoryCanvas, canvas) || _selectionHistoryBefore == null)
            {
                return;
            }

            PushHistory(_undoHistory, new InkSnapshotHistoryEntry(canvas, _selectionHistoryBefore, canvas.Strokes));
            _redoHistory.Clear();
            _selectionHistoryCanvas = null;
            _selectionHistoryBefore = null;
            SaveCurrentPageInk();
        }

        private void AttachSelectionHistory(InkCanvas canvas)
        {
            canvas.SelectionMoving += InkCanvas_SelectionChanging;
            canvas.SelectionMoved += InkCanvas_SelectionChanged;
            canvas.SelectionResizing += InkCanvas_SelectionChanging;
            canvas.SelectionResized += InkCanvas_SelectionChanged;
        }

        private void DetachSelectionHistory(InkCanvas canvas)
        {
            canvas.SelectionMoving -= InkCanvas_SelectionChanging;
            canvas.SelectionMoved -= InkCanvas_SelectionChanged;
            canvas.SelectionResizing -= InkCanvas_SelectionChanging;
            canvas.SelectionResized -= InkCanvas_SelectionChanged;
        }

        private void InkCanvas_SelectionChanging(object? sender, InkCanvasSelectionEditingEventArgs e)
        {
            if (sender is InkCanvas canvas)
            {
                BeginSelectionHistory(canvas);
            }
        }

        private void InkCanvas_SelectionChanged(object? sender, EventArgs e)
        {
            if (sender is InkCanvas canvas)
            {
                CompleteSelectionHistory(canvas);
            }
        }

        private void ResetInkHistory(InkCanvas canvas)
        {
            _undoHistory.RemoveAll(entry => entry.BelongsTo(canvas));
            _redoHistory.RemoveAll(entry => entry.BelongsTo(canvas));
        }

        private static void PushHistory(List<EditorHistoryEntry> history, EditorHistoryEntry entry)
        {
            history.Add(entry);
            while (history.Count > MaximumHistorySteps)
            {
                history.RemoveAt(0);
            }
        }

        private void EditorPage_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (!Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                return;
            }

            bool redo = e.Key == Key.Y || (e.Key == Key.Z && Keyboard.Modifiers.HasFlag(ModifierKeys.Shift));
            bool undo = e.Key == Key.Z && !Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
            if (!undo && !redo)
            {
                return;
            }

            ApplyHistory(redo);
            e.Handled = true;
        }

        private void ApplyHistory(bool redo)
        {
            var source = redo ? _redoHistory : _undoHistory;
            var destination = redo ? _undoHistory : _redoHistory;
            if (source.Count == 0)
            {
                return;
            }

            int lastIndex = source.Count - 1;
            var entry = source[lastIndex];
            source.RemoveAt(lastIndex);
            _isApplyingEditorHistory = true;
            try
            {
                if (redo)
                {
                    entry.Redo(this);
                }
                else
                {
                    entry.Undo(this);
                }
            }
            finally
            {
                _isApplyingEditorHistory = false;
            }

            PushHistory(destination, entry);
            if (entry.ChangesInk)
            {
                SaveCurrentPageInk();
            }
        }

    }
}
