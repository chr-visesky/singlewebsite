using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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
        /// Creates a visual with the ink strokes for printing by using an offscreen InkCanvas
        /// </summary>
        public static DrawingVisual CreateInkVisual(StrokeCollection strokes, double scaleX, double scaleY)
        {
            if (strokes == null || strokes.Count == 0)
            {
                return new DrawingVisual();
            }

            // Transform strokes for print
            var matrix = new Matrix(scaleX, 0, 0, scaleY, 0, 0);
            var transformedStrokes = strokes.Clone();
            transformedStrokes.Transform(matrix, false);

            // Get bounds of strokes
            var bounds = transformedStrokes.GetBounds();

            if (bounds.IsEmpty)
            {
                return new DrawingVisual();
            }

            // Create an InkCanvas to render the strokes
            var inkCanvas = new InkCanvas
            {
                Width = bounds.Right + 1,
                Height = bounds.Bottom + 1
            };
            inkCanvas.Strokes.Add(transformedStrokes);

            // Render the InkCanvas to a bitmap
            var rtb = new RenderTargetBitmap(
                (int)inkCanvas.Width,
                (int)inkCanvas.Height,
                96, 96,
                PixelFormats.Pbgra32);

            rtb.Render(inkCanvas);

            // Create a visual with the rendered bitmap
            var visual = new DrawingVisual();
            using (var context = visual.RenderOpen())
            {
                context.DrawImage(rtb, new Rect(0, 0, rtb.PixelWidth, rtb.PixelHeight));
            }

            return visual;
        }
    }
}
