using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Ink;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;
using HomeworkApp.Services;

namespace HomeworkApp.Views
{
    public sealed class HomeworkPrintRenderer
    {
        private const double PortraitLogicalWidth = 210 * 3.78;
        private const double PortraitLogicalHeight = 297 * 3.78;
        private const double LandscapeLogicalWidth = 297 * 3.78;
        private const double LandscapeLogicalHeight = 210 * 3.78;
        private const double DefaultPrintDpi = 300;

        private readonly JobSession _job;
        private readonly DocumentService _documentService;

        public static Size DefaultPageSize => new(794, 1123);

        public HomeworkPrintRenderer(JobSession job, DocumentService documentService)
        {
            _job = job;
            _documentService = documentService;
        }

        public FixedDocument CreateFixedDocument(Size pageSize)
        {
            var normalizedPageSize = NormalizePageSize(pageSize);
            var fixedDocument = new FixedDocument();
            fixedDocument.DocumentPaginator.PageSize = normalizedPageSize;

            for (int pageIndex = 0; pageIndex < Math.Max(1, _job.TotalPages); pageIndex++)
            {
                var fixedPage = CreateFixedPage(pageIndex, normalizedPageSize);
                var pageContent = new PageContent();
                ((IAddChild)pageContent).AddChild(fixedPage);
                fixedDocument.Pages.Add(pageContent);
            }

            return fixedDocument;
        }

        public FixedDocument CreateBitmapFixedDocument(Size pageSize, double dpi = DefaultPrintDpi)
        {
            var normalizedPageSize = NormalizePageSize(pageSize);
            var fixedDocument = new FixedDocument();
            fixedDocument.DocumentPaginator.PageSize = normalizedPageSize;

            for (int pageIndex = 0; pageIndex < Math.Max(1, _job.TotalPages); pageIndex++)
            {
                var fixedPage = CreateBitmapFixedPage(pageIndex, normalizedPageSize, dpi);
                var pageContent = new PageContent();
                ((IAddChild)pageContent).AddChild(fixedPage);
                fixedDocument.Pages.Add(pageContent);
            }

            return fixedDocument;
        }

        public RenderTargetBitmap RenderPagePreview(int pageNumber, Size pageSize, double dpi = 96)
        {
            var normalizedPageSize = NormalizePageSize(pageSize);
            var renderScale = Math.Max(1, dpi / 96.0);
            var page = CreatePageVisual(pageNumber, normalizedPageSize, renderScale);
            int pixelWidth = Math.Max(1, (int)Math.Ceiling(normalizedPageSize.Width * dpi / 96.0));
            int pixelHeight = Math.Max(1, (int)Math.Ceiling(normalizedPageSize.Height * dpi / 96.0));
            var bitmap = new RenderTargetBitmap(pixelWidth, pixelHeight, dpi, dpi, PixelFormats.Pbgra32);
            bitmap.Render(page);
            bitmap.Freeze();
            return bitmap;
        }

        private FixedPage CreateFixedPage(int pageNumber, Size pageSize)
        {
            var fixedPage = new FixedPage
            {
                Width = pageSize.Width,
                Height = pageSize.Height
            };
            var pageVisual = CreatePageVisual(pageNumber, pageSize);
            FixedPage.SetLeft(pageVisual, 0);
            FixedPage.SetTop(pageVisual, 0);
            fixedPage.Children.Add(pageVisual);
            PrepareVisual(fixedPage, pageSize);
            return fixedPage;
        }

        private FixedPage CreateBitmapFixedPage(int pageNumber, Size pageSize, double dpi)
        {
            var fixedPage = new FixedPage
            {
                Width = pageSize.Width,
                Height = pageSize.Height
            };

            // Printing rasterized pages avoids WPF/XPS ink vector artifacts and makes
            // the generated PDF match the on-screen homework page.
            var image = new Image
            {
                Width = pageSize.Width,
                Height = pageSize.Height,
                Source = RenderPagePreview(pageNumber, pageSize, dpi),
                Stretch = Stretch.Fill,
                SnapsToDevicePixels = true
            };
            RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);

            FixedPage.SetLeft(image, 0);
            FixedPage.SetTop(image, 0);
            fixedPage.Children.Add(image);
            PrepareVisual(fixedPage, pageSize);
            return fixedPage;
        }

        private FrameworkElement CreatePageVisual(int pageNumber, Size pageSize, double renderScale = 1)
        {
            var logicalPageSize = GetLogicalPageSize();
            var root = new Grid
            {
                Width = pageSize.Width,
                Height = pageSize.Height,
                Background = Brushes.White,
                SnapsToDevicePixels = true
            };

            root.Children.Add(new Viewbox
            {
                Stretch = Stretch.Uniform,
                StretchDirection = StretchDirection.Both,
                Child = CreateLogicalPage(pageNumber, logicalPageSize, renderScale)
            });

            PrepareVisual(root, pageSize);
            return root;
        }

        private FrameworkElement CreateLogicalPage(int pageNumber, Size logicalPageSize, double renderScale)
        {
            var page = new Grid
            {
                Width = logicalPageSize.Width,
                Height = logicalPageSize.Height,
                Background = Brushes.White,
                SnapsToDevicePixels = true
            };

            page.Children.Add(new Border
            {
                Width = logicalPageSize.Width,
                Height = logicalPageSize.Height,
                Background = Brushes.White
            });

            var docPage = _documentService
                .GetPageAsync(pageNumber, logicalPageSize.Width * Math.Max(1, renderScale), logicalPageSize.Height * Math.Max(1, renderScale))
                .ConfigureAwait(false)
                .GetAwaiter()
                .GetResult();

            if (docPage?.Image != null)
            {
                var image = new Image
                {
                    Width = logicalPageSize.Width,
                    Height = logicalPageSize.Height,
                    Source = docPage.Image,
                    Stretch = Stretch.Uniform,
                    SnapsToDevicePixels = true
                };
                RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.HighQuality);
                page.Children.Add(image);
            }

            string inkPath = _job.GetInkFilePath(pageNumber);
            var strokes = InkService.LoadInk(inkPath);
            if (strokes != null && strokes.Count > 0)
            {
                page.Children.Add(new InkPresenter
                {
                    Width = logicalPageSize.Width,
                    Height = logicalPageSize.Height,
                    Strokes = strokes.Clone(),
                    IsHitTestVisible = false,
                    SnapsToDevicePixels = true
                });
            }

            return page;
        }

        private Size GetLogicalPageSize()
        {
            return _job.IsPortrait
                ? new Size(PortraitLogicalWidth, PortraitLogicalHeight)
                : new Size(LandscapeLogicalWidth, LandscapeLogicalHeight);
        }

        private static Size NormalizePageSize(Size pageSize)
        {
            return pageSize.Width > 0 && pageSize.Height > 0 ? pageSize : DefaultPageSize;
        }

        private static void PrepareVisual(FrameworkElement visual, Size size)
        {
            visual.Measure(size);
            visual.Arrange(new Rect(new Point(0, 0), size));
            visual.UpdateLayout();
        }
    }
}
