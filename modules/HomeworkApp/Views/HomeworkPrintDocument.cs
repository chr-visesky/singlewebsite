using System;
using System.Collections.Generic;
using System.Printing;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using HomeworkApp.Models;
using HomeworkApp.Services;

namespace HomeworkApp.Views
{
    /// <summary>
    /// Print document for homework pages.
    /// </summary>
    public class HomeworkPrintDocument
    {
        private readonly HomeworkPrintRenderer _renderer;
        private readonly JobSession _job;

        public HomeworkPrintDocument(JobSession job, DocumentService documentService)
        {
            _job = job;
            _renderer = new HomeworkPrintRenderer(job, documentService);
        }

        public void Print(
            PrintQueue printQueue,
            PrintTicket? printTicket = null,
            IReadOnlyCollection<int>? pageIndexes = null)
        {
            var printDialog = new PrintDialog
            {
                PrintQueue = printQueue,
                PrintTicket = printTicket ?? printQueue.UserPrintTicket ?? printQueue.DefaultPrintTicket ?? new PrintTicket()
            };
            printDialog.PrintTicket.PageOrientation = _job.IsPortrait ? PageOrientation.Portrait : PageOrientation.Landscape;

            var pageSize = ResolvePrintableArea(printQueue, printDialog.PrintTicket, printDialog);
            var renderDpi = ResolveRenderDpi(printQueue, printDialog.PrintTicket);
            var fixedDocument = _renderer.CreateBitmapFixedDocument(pageSize, renderDpi, pageIndexes);
            printDialog.PrintDocument(fixedDocument.DocumentPaginator, "Homework");
        }

        public BitmapSource CreatePreviewBitmap(int pageNumber, Size pageSize, double dpi = 96)
        {
            return _renderer.RenderPagePreview(pageNumber, pageSize, dpi);
        }

        private static Size ResolvePrintableArea(PrintQueue printQueue, PrintTicket? printTicket, PrintDialog printDialog)
        {
            try
            {
                var capabilities = printQueue.GetPrintCapabilities(printTicket);
                var imageableArea = capabilities.PageImageableArea;

                if (imageableArea != null &&
                    imageableArea.ExtentWidth > 0 &&
                    imageableArea.ExtentHeight > 0)
                {
                    return new Size(imageableArea.ExtentWidth, imageableArea.ExtentHeight);
                }
            }
            catch
            {
            }

            if (printDialog.PrintableAreaWidth > 0 && printDialog.PrintableAreaHeight > 0)
            {
                return new Size(printDialog.PrintableAreaWidth, printDialog.PrintableAreaHeight);
            }

            return HomeworkPrintRenderer.DefaultPageSize;
        }

        private static double ResolveRenderDpi(PrintQueue printQueue, PrintTicket? printTicket)
        {
            double selectedDpi = ExtractDpi(printTicket?.PageResolution);
            if (selectedDpi > 0)
            {
                return Math.Max(300, selectedDpi);
            }

            double userTicketDpi = ExtractDpi(printQueue.UserPrintTicket?.PageResolution);
            if (userTicketDpi > 0)
            {
                return Math.Max(300, userTicketDpi);
            }

            double defaultTicketDpi = ExtractDpi(printQueue.DefaultPrintTicket?.PageResolution);
            if (defaultTicketDpi > 0)
            {
                return Math.Max(300, defaultTicketDpi);
            }

            return 300;
        }

        private static double ExtractDpi(PageResolution? resolution)
        {
            if (resolution == null)
            {
                return 0;
            }

            double x = resolution.X ?? 0;
            double y = resolution.Y ?? 0;
            if (x > 0 && y > 0)
            {
                return Math.Min(x, y);
            }

            return x > 0 ? x : y;
        }
    }
}
