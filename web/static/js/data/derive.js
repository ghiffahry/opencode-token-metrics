/* Derived view helpers: weekly grouping for 90d chart buckets. */

export function weeklyGroup(buckets) {
  var groups = [];
  for (var i = 0; i < buckets.length; i += 7) {
    var slice = buckets.slice(i, i + 7);
    var item = {
      label: slice[slice.length - 1].label,
      requests: 0, input: 0, output: 0
    };
    slice.forEach(function (b) {
      item.requests += b.requests;
      item.input += b.input;
      item.output += b.output;
    });
    groups.push(item);
  }
  return groups;
}
