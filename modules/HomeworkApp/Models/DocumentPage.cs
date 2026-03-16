using System.Windows.Media;

namespace HomeworkApp.Models
{
    /// <summary>
    /// Represents a rendered document page
    /// </summary>
    public class DocumentPage
    {
        public int PageIndex { get; set; }
        public ImageSource? Image { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public double RenderWidth { get; set; }
        public double RenderHeight { get; set; }
        public bool IsRendered => Image != null;
    }
}
