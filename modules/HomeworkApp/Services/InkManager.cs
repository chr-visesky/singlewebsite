using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Media;

namespace HomeworkApp.Services
{
    /// <summary>
    /// Manages ink canvas operations using native InkCanvas input with FitToCurve enabled
    /// </summary>
    public class InkManager
    {
        private readonly InkCanvas _inkCanvas;
        private double _logicalWidth;
        private double _logicalHeight;
        private Matrix _currentTransform = Matrix.Identity;
        private Color _currentColor = Colors.Black;
        private double _currentWidth = 3.0;

        public enum ToolMode
        {
            Pen,
            Eraser,
            Highlighter,
            Select,
            None
        }

        public ToolMode CurrentTool { get; private set; } = ToolMode.Pen;

        public InkManager(InkCanvas inkCanvas, double logicalWidth, double logicalHeight, double screenWidth, double screenHeight)
        {
            _inkCanvas = inkCanvas;
            _logicalWidth = logicalWidth;
            _logicalHeight = logicalHeight;

            // Calculate transform matrix from logical to screen coordinates
            _currentTransform = new Matrix(
                screenWidth / logicalWidth,
                0,
                0,
                screenHeight / logicalHeight,
                0,
                0);

            SetupInkCanvas();
        }

        private void SetupInkCanvas()
        {
            _inkCanvas.DefaultDrawingAttributes = CreatePenDrawingAttributes();
            _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
            _inkCanvas.UseCustomCursor = true;
        }

        public void SetTool(ToolMode tool)
        {
            CurrentTool = tool;

            switch (tool)
            {
                case ToolMode.Pen:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
                    _inkCanvas.DefaultDrawingAttributes = CreatePenDrawingAttributes();
                    break;

                case ToolMode.Eraser:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.EraseByPoint;
                    break;

                case ToolMode.Highlighter:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
                    _inkCanvas.DefaultDrawingAttributes = CreateHighlighterDrawingAttributes();
                    break;

                case ToolMode.Select:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.Select;
                    break;

                case ToolMode.None:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.None;
                    break;
            }
        }

        public void SetPenColor(Color color)
        {
            _currentColor = color;

            if (CurrentTool == ToolMode.Pen)
            {
                _inkCanvas.DefaultDrawingAttributes = CreatePenDrawingAttributes();
            }
        }

        public void SetPenWidth(double width)
        {
            _currentWidth = width;

            if (CurrentTool == ToolMode.Pen || CurrentTool == ToolMode.Highlighter)
            {
                _inkCanvas.DefaultDrawingAttributes = CurrentTool == ToolMode.Highlighter
                    ? CreateHighlighterDrawingAttributes()
                    : CreatePenDrawingAttributes();
            }
        }

        public StrokeCollection? GetStrokes()
        {
            if (_inkCanvas.Strokes == null || _inkCanvas.Strokes.Count == 0)
            {
                return null;
            }

            // Transform strokes from screen coordinates back to logical coordinates
            var inverseTransform = _currentTransform;
            inverseTransform.Invert();

            var strokes = _inkCanvas.Strokes.Clone();
            strokes.Transform(inverseTransform, true);

            return strokes;
        }

        public void SetStrokes(StrokeCollection? strokes)
        {
            _inkCanvas.Strokes.Clear();

            if (strokes != null && strokes.Count > 0)
            {
                // Transform strokes from logical to screen coordinates
                var transformedStrokes = strokes.Clone();
                transformedStrokes.Transform(_currentTransform, false);
                _inkCanvas.Strokes.Add(transformedStrokes);
            }
        }

        public void Clear()
        {
            _inkCanvas.Strokes.Clear();
        }

        public void UpdateTransform(double newScreenWidth, double newScreenHeight)
        {
            var newTransform = new Matrix(
                newScreenWidth / _logicalWidth,
                0,
                0,
                newScreenHeight / _logicalHeight,
                0,
                0);

            // Calculate scale difference
            var scaleTransform = new Matrix(
                newTransform.M11 / _currentTransform.M11,
                0,
                0,
                newTransform.M22 / _currentTransform.M22,
                0,
                0);

            // Scale existing strokes
            if (_inkCanvas.Strokes.Count > 0)
            {
                _inkCanvas.Strokes.Transform(scaleTransform, true);
            }

            _currentTransform = newTransform;
        }

        /// <summary>
        /// Update canvas size for orientation change (portrait/landscape)
        /// </summary>
        public void UpdateCanvasSize(double newLogicalWidth, double newLogicalHeight, double newCanvasWidth, double newCanvasHeight)
        {
            // Calculate scale factor for existing strokes
            var scaleX = newLogicalWidth / _logicalWidth;
            var scaleY = newLogicalHeight / _logicalHeight;

            // Scale existing strokes
            if (_inkCanvas.Strokes.Count > 0)
            {
                var scaleTransform = new Matrix(scaleX, 0, 0, scaleY, 0, 0);
                _inkCanvas.Strokes.Transform(scaleTransform, true);
            }

            // Update logical dimensions
            _logicalWidth = newLogicalWidth;
            _logicalHeight = newLogicalHeight;

            // Recalculate transform based on new canvas size
            _currentTransform = new Matrix(
                newCanvasWidth / _logicalWidth,
                0,
                0,
                newCanvasHeight / _logicalHeight,
                0,
                0);
        }

        public Matrix GetCurrentTransform() => _currentTransform;

        private DrawingAttributes CreatePenDrawingAttributes()
        {
            return new DrawingAttributes
            {
                Color = _currentColor,
                Width = _currentWidth,
                Height = _currentWidth,
                FitToCurve = true,
                IgnorePressure = false,
                StylusTip = StylusTip.Ellipse,
                StylusTipTransform = Matrix.Identity,
                IsHighlighter = false
            };
        }

        private DrawingAttributes CreateHighlighterDrawingAttributes()
        {
            return new DrawingAttributes
            {
                Color = Color.FromArgb(100, 255, 255, 0),
                Width = _currentWidth,
                Height = _currentWidth,
                FitToCurve = true,
                IgnorePressure = false,
                StylusTip = StylusTip.Ellipse,
                StylusTipTransform = Matrix.Identity,
                IsHighlighter = true
            };
        }
    }
}
