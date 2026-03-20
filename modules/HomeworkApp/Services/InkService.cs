using System;
using System.IO;
using System.Windows.Ink;
using System.Windows.Media;

namespace HomeworkApp.Services
{
    /// <summary>
    /// Service for saving and loading ink data
    /// </summary>
    public class InkService
    {
        /// <summary>
        /// Saves ink strokes to a file
        /// </summary>
        public static void SaveInk(StrokeCollection strokes, string filePath)
        {
            try
            {
                string? directory = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                using var fs = new FileStream(filePath, FileMode.Create, FileAccess.Write);
                strokes.Save(fs);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error saving ink: {ex.Message}");
            }
        }

        /// <summary>
        /// Loads ink strokes from a file
        /// </summary>
        public static StrokeCollection? LoadInk(string filePath)
        {
            try
            {
                if (!File.Exists(filePath))
                {
                    return null;
                }

                using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read);
                return new StrokeCollection(fs);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error loading ink: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Creates a visual with ink strokes for printing by drawing the strokes directly
        /// into the print coordinate space. This preserves the original page-relative
        /// stroke positions instead of rasterizing to the strokes' local bounds.
        /// </summary>
        public static DrawingVisual CreateInkVisual(
            StrokeCollection strokes,
            double scaleX,
            double scaleY,
            double offsetX = 0,
            double offsetY = 0)
        {
            if (strokes == null || strokes.Count == 0)
            {
                return new DrawingVisual();
            }

            // Transform strokes into print coordinates while preserving their original
            // page-relative offsets.
            var transformedStrokes = strokes.Clone();
            var matrix = new Matrix(scaleX, 0, 0, scaleY, offsetX, offsetY);
            transformedStrokes.Transform(matrix, false);

            var visual = new DrawingVisual();
            using (var context = visual.RenderOpen())
            {
                transformedStrokes.Draw(context);
            }

            return visual;
        }
    }
}
