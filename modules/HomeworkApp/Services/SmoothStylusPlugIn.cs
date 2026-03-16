using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Input.StylusPlugIns;

namespace HomeworkApp.Services
{
    /// <summary>
    /// Custom StylusPlugIn for real-time ink smoothing using One Euro Filter
    /// Preserves Chinese character strokes while reducing jitter
    /// </summary>
    public class SmoothStylusPlugIn : StylusPlugIn
    {
        private readonly OneEuroFilter _filter;
        private readonly InkCanvas _inkCanvas;
        private Stroke? _currentStroke;
        private StylusPointCollection? _currentPoints;
        private Color _currentColor = Colors.Black;
        private double _width = 3.0;

        public SmoothStylusPlugIn(InkCanvas inkCanvas)
        {
            _inkCanvas = inkCanvas;
            _filter = new OneEuroFilter(freq: 120.0, minCutoff: 0.5, beta: 0.005, dCutoff: 0.1);
        }

        public void SetPenColor(Color color)
        {
            _currentColor = color;
        }

        public void SetPenWidth(double width)
        {
            _width = width;
        }

        public void Reset()
        {
            _filter.Reset();
            _currentStroke = null;
            _currentPoints = null;
        }

        protected override void OnStylusDown(RawStylusInput rawStylusInput)
        {
            // Start new stroke
            _filter.Reset();
            _currentPoints = new StylusPointCollection();

            var points = rawStylusInput.GetStylusPoints();
            if (points.Count > 0)
            {
                var firstPoint = points[0];
                var (filteredX, filteredY) = _filter.Filter(
                    firstPoint.X,
                    firstPoint.Y,
                    DateTime.Now.Ticks / 10000000.0);

                _currentPoints.Add(new StylusPoint(
                    (float)filteredX,
                    (float)filteredY,
                    firstPoint.PressureFactor));
            }

            base.OnStylusDown(rawStylusInput);
        }

        protected override void OnStylusMove(RawStylusInput rawStylusInput)
        {
            if (_currentPoints == null) return;

            var points = rawStylusInput.GetStylusPoints();
            if (points.Count == 0) return;

            // Get last point for filtering
            var lastPoint = points[points.Count - 1];
            var timestamp = DateTime.Now.Ticks / 10000000.0;

            var (filteredX, filteredY) = _filter.Filter(
                lastPoint.X,
                lastPoint.Y,
                timestamp);

            _currentPoints.Add(new StylusPoint(
                (float)filteredX,
                (float)filteredY,
                lastPoint.PressureFactor));

            // Real-time visual feedback using DynamicRenderer
            base.OnStylusMove(rawStylusInput);
        }

        protected override void OnStylusUp(RawStylusInput rawStylusInput)
        {
            if (_currentPoints != null && _currentPoints.Count > 1)
            {
                // Create final stroke with smoothed points
                var drawingAttributes = new DrawingAttributes
                {
                    Color = _currentColor,
                    Width = _width,
                    Height = _width,
                    FitToCurve = true,
                    IgnorePressure = false,
                    StylusTip = StylusTip.Ellipse,
                    StylusTipTransform = Matrix.Identity,
                    IsHighlighter = false
                };

                _currentStroke = new Stroke(_currentPoints)
                {
                    DrawingAttributes = drawingAttributes
                };

                // Add to ink canvas
                _inkCanvas.Strokes.Add(_currentStroke);
            }

            _currentPoints = null;
            _currentStroke = null;

            base.OnStylusUp(rawStylusInput);
        }
    }
}
