using System;

namespace HomeworkApp.Services
{
    /// <summary>
    /// One Euro Filter for real-time stylus input smoothing
    /// Optimized for Chinese handwriting - preserves sharp corners while reducing jitter
    /// </summary>
    public class OneEuroFilter
    {
        private double _freq;
        private double _minCutoff;
        private double _beta;
        private double _dCutoff;

        private double? _lastRawX;
        private double? _lastRawY;
        private double? _lastFilteredX;
        private double? _lastFilteredY;
        private double? _lastTime;

        public OneEuroFilter(double freq = 60.0, double minCutoff = 1.0, double beta = 0.01, double dCutoff = 1.0)
        {
            _freq = freq;
            _minCutoff = minCutoff;
            _beta = beta;
            _dCutoff = dCutoff;
        }

        public void Reset()
        {
            _lastRawX = null;
            _lastRawY = null;
            _lastFilteredX = null;
            _lastFilteredY = null;
            _lastTime = null;
        }

        public (double x, double y) Filter(double x, double y, double timestamp)
        {
            if (_lastTime == null)
            {
                // First point - no filtering
                _lastRawX = x;
                _lastRawY = y;
                _lastFilteredX = x;
                _lastFilteredY = y;
                _lastTime = timestamp;
                return (x, y);
            }

            double dt = timestamp - _lastTime.Value;
            if (dt <= 0) dt = 1.0 / _freq;

            // Compute alpha using cutoff frequency
            double cutoff = ComputeCutoff(dt, x, y);
            double alpha = ComputeAlpha(cutoff, dt);

            // Filter X and Y independently
            double filteredX = ExponentialSmoothing(x, _lastFilteredX ?? x, alpha);
            double filteredY = ExponentialSmoothing(y, _lastFilteredY ?? y, alpha);

            // Update state
            _lastRawX = x;
            _lastRawY = y;
            _lastFilteredX = filteredX;
            _lastFilteredY = filteredY;
            _lastTime = timestamp;

            return (filteredX, filteredY);
        }

        private double ComputeCutoff(double dt, double x, double y)
        {
            // Compute speed
            double dx = _lastRawX.HasValue ? Math.Abs(x - _lastRawX.Value) / dt : 0;
            double dy = _lastRawY.HasValue ? Math.Abs(y - _lastRawY.Value) / dt : 0;
            double speed = Math.Sqrt(dx * dx + dy * dy);

            // Higher speed = higher cutoff (less smoothing for fast strokes)
            // This preserves sharp corners in Chinese characters
            return _minCutoff + _beta * speed;
        }

        private double ComputeAlpha(double cutoff, double dt)
        {
            double tau = 1.0 / (2 * Math.PI * cutoff);
            double te = dt;
            return 1.0 / (1.0 + tau / te);
        }

        private double ExponentialSmoothing(double value, double lastFiltered, double alpha)
        {
            return alpha * value + (1 - alpha) * lastFiltered;
        }
    }
}
