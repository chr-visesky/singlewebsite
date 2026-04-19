using System.Collections.Generic;
using System.Linq;

namespace DictationApp.Models;

public sealed class DictationTaskCardGroup
{
    public DictationTaskCardGroup(string title, IEnumerable<DictationTaskCardItem> tasks)
    {
        Title = title;
        Tasks = tasks.ToList();
    }

    public string Title { get; }

    public List<DictationTaskCardItem> Tasks { get; }

    public string HeaderText => $"{Title} ({Tasks.Count})";
}
