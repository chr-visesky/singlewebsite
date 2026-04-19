using System;
using System.Windows;
using System.Windows.Ink;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DictationApp.Services;

public static class DictationInkPreviewRenderer
{
    public static ImageSource? Render(StrokeCollection? strokes, int width = 136, int height = 68)
    {
        if (strokes is null || strokes.Count == 0)
        {
            return null;
        }

        StrokeCollection previewStrokes = strokes.Clone();
        Rect bounds = previewStrokes.GetBounds();

        if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0)
        {
            return null;
        }

        double padding = 10;
        double availableWidth = Math.Max(1, width - (padding * 2));
        double availableHeight = Math.Max(1, height - (padding * 2));
        double scale = Math.Min(availableWidth / bounds.Width, availableHeight / bounds.Height);

        previewStrokes.Transform(BuildTranslateMatrix(-bounds.Left, -bounds.Top), false);
        previewStrokes.Transform(BuildScaleMatrix(scale), false);

        Rect normalizedBounds = previewStrokes.GetBounds();
        double offsetX = padding + ((availableWidth - normalizedBounds.Width) / 2);
        double offsetY = padding + ((availableHeight - normalizedBounds.Height) / 2);
        previewStrokes.Transform(BuildTranslateMatrix(offsetX, offsetY), false);

        var visual = new DrawingVisual();

        using (DrawingContext drawingContext = visual.RenderOpen())
        {
            previewStrokes.Draw(drawingContext);
        }

        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        return bitmap;
    }

    private static Matrix BuildTranslateMatrix(double offsetX, double offsetY)
    {
        Matrix matrix = Matrix.Identity;
        matrix.Translate(offsetX, offsetY);
        return matrix;
    }

    private static Matrix BuildScaleMatrix(double scale)
    {
        Matrix matrix = Matrix.Identity;
        matrix.Scale(scale, scale);
        return matrix;
    }
}
