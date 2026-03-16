using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;

namespace HomeworkApp.Services
{
    /// <summary>
    /// Manages ink canvas operations with real-time stylus input processing
    /// Uses One Euro Filter for jitter reduction while preserving Chinese character strokes
    /// </summary>
    public class InkManager
    {
        private readonly InkCanvas _inkCanvas;
        private double _logicalWidth;
        private double _logicalHeight;
        private Matrix _currentTransform = Matrix.Identity;

        private readonly OneEuroFilter _filter;
        private StylusPointCollection? _currentStrokePoints;
        private Color _currentColor = Colors.Black;
        private double _currentWidth = 3.0;

        public enum ToolMode
        {
            Pen,
            Eraser,
            Highlighter
        }

        public ToolMode CurrentTool { get; private set; } = ToolMode.Pen;

        public InkManager(InkCanvas inkCanvas, double logicalWidth, double logicalHeight, double screenWidth, double screenHeight)
        {
            _inkCanvas = inkCanvas;
            _logicalWidth = logicalWidth;
            _logicalHeight = logicalHeight;

            // Initialize One Euro Filter for real-time smoothing
            _filter = new OneEuroFilter(freq: 100.0, minCutoff: 0.3, beta: 0.003, dCutoff: 0.1);

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
            // Configure default pen
            var pen = new DrawingAttributes
            {
                Color = Colors.Black,
                Width = 3,
                Height = 3,
                FitToCurve = true,
                IgnorePressure = false,
                StylusTip = StylusTip.Ellipse,
                StylusTipTransform = Matrix.Identity
            };

            _inkCanvas.DefaultDrawingAttributes = pen;
            _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
            _inkCanvas.UseCustomCursor = true;

            // Hook into stylus events for real-time filtering
            _inkCanvas.PreviewStylusDown += OnPreviewStylusDown;
            _inkCanvas.PreviewStylusMove += OnPreviewStylusMove;
            _inkCanvas.PreviewStylusUp += OnPreviewStylusUp;
        }

        private void OnPreviewStylusDown(object sender, StylusDownEventArgs e)
        {
            if (CurrentTool != ToolMode.Pen) return;

            // Start new stroke - reset filter
            _filter.Reset();
            _currentStrokePoints = new StylusPointCollection();

            var points = e.GetStylusPoints(_inkCanvas);
            if (points.Count > 0)
            {
                var firstPoint = points[0];
                var timestamp = DateTime.Now.Ticks / 10000000.0;

                var (filteredX, filteredY) = _filter.Filter(firstPoint.X, firstPoint.Y, timestamp);

                _currentStrokePoints?.Add(new StylusPoint(
                    (float)filteredX,
                    (float)filteredY,
                    firstPoint.PressureFactor));
            }
        }

        private void OnPreviewStylusMove(object sender, StylusEventArgs e)
        {
            if (CurrentTool != ToolMode.Pen || _currentStrokePoints == null) return;

            var points = e.GetStylusPoints(_inkCanvas);
            if (points.Count == 0) return;

            var lastPoint = points[points.Count - 1];
            var timestamp = DateTime.Now.Ticks / 10000000.0;

            var (filteredX, filteredY) = _filter.Filter(lastPoint.X, lastPoint.Y, timestamp);

            _currentStrokePoints.Add(new StylusPoint(
                (float)filteredX,
                (float)filteredY,
                lastPoint.PressureFactor));
        }

        private void OnPreviewStylusUp(object sender, StylusEventArgs e)
        {
            if (CurrentTool != ToolMode.Pen || _currentStrokePoints == null || _currentStrokePoints.Count < 2)
            {
                _currentStrokePoints = null;
                return;
            }

            // Create final stroke with filtered points
            var drawingAttributes = new DrawingAttributes
            {
                Color = _currentColor,
                Width = _currentWidth,
                Height = _currentWidth,
                FitToCurve = true,
                IgnorePressure = false,
                StylusTip = StylusTip.Ellipse,
                StylusTipTransform = Matrix.Identity
            };

            var stroke = new Stroke(_currentStrokePoints)
            {
                DrawingAttributes = drawingAttributes
            };

            // Add to ink canvas (bypass normal event to avoid double-processing)
            _inkCanvas.Strokes.Add(stroke);

            _currentStrokePoints = null;
        }

        public void SetTool(ToolMode tool)
        {
            CurrentTool = tool;

            switch (tool)
            {
                case ToolMode.Pen:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
                    _inkCanvas.PreviewStylusDown += OnPreviewStylusDown;
                    _inkCanvas.PreviewStylusMove += OnPreviewStylusMove;
                    _inkCanvas.PreviewStylusUp += OnPreviewStylusUp;
                    break;

                case ToolMode.Eraser:
                    // Remove preview handlers for eraser mode
                    _inkCanvas.PreviewStylusDown -= OnPreviewStylusDown;
                    _inkCanvas.PreviewStylusMove -= OnPreviewStylusMove;
                    _inkCanvas.PreviewStylusUp -= OnPreviewStylusUp;
                    _inkCanvas.EditingMode = InkCanvasEditingMode.EraseByPoint;
                    break;

                case ToolMode.Highlighter:
                    _inkCanvas.EditingMode = InkCanvasEditingMode.Ink;
                    // Remove preview handlers for highlighter (use default rendering)
                    _inkCanvas.PreviewStylusDown -= OnPreviewStylusDown;
                    _inkCanvas.PreviewStylusMove -= OnPreviewStylusMove;
                    _inkCanvas.PreviewStylusUp -= OnPreviewStylusUp;

                    var highlighter = new DrawingAttributes
                    {
                        Color = Color.FromArgb(100, 255, 255, 0),
                        Width = 20,
                        Height = 20,
                        FitToCurve = true,
                        IgnorePressure = false,
                        IsHighlighter = true
                    };
                    _inkCanvas.DefaultDrawingAttributes = highlighter;
                    break;
            }
        }

        public void SetPenColor(Color color)
        {
            if (CurrentTool == ToolMode.Pen)
            {
                _currentColor = color;
                var attrs = _inkCanvas.DefaultDrawingAttributes.Clone();
                attrs.Color = color;
                _inkCanvas.DefaultDrawingAttributes = attrs;
            }
        }

        public void SetPenWidth(double width)
        {
            if (CurrentTool == ToolMode.Pen || CurrentTool == ToolMode.Highlighter)
            {
                _currentWidth = width;
                var attrs = _inkCanvas.DefaultDrawingAttributes.Clone();
                attrs.Width = width;
                attrs.Height = width;
                _inkCanvas.DefaultDrawingAttributes = attrs;
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
    }
}
