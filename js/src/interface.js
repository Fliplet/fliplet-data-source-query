let data = Fliplet.Widget.getData();
let initialResult = data.result;
let settings = data.settings;
let accessRules = data.accessRules || [];

function getInitialColumns() {
  if (initialResult && initialResult.columns) {
    return initialResult.columns;
  }
  return {};
}

function getInitialFilters() {
  if (initialResult && initialResult.applyFilters) {
    return initialResult.applyFilters;
  }
  return false;
}

if (!settings.modes) {
  settings.modes = [{
    columns: settings.columns || []
  }];
}

// Defaults
settings.modes.forEach((mode) => {
  mode.filters = typeof mode.filters === 'undefined' ? true : mode.filters
  mode.columns.forEach((col) => {
    if (!col.type || ['single', 'multiple'].indexOf(col.type) === -1) {
      col.type = 'single'
    }
  });
});

$(window).on('resize', Fliplet.Widget.autosize);

let app = new Vue({
  el: '#app',
  created() {
    if (initialResult && initialResult.filters && initialResult.filters.$and) {
      this.filters = initialResult.filters.$and.map((filterDataEntry) => {
        let columnKey = Object.keys(filterDataEntry)[0];
        let innerObject = filterDataEntry[columnKey];
        let sequelizeOperator = Object.keys(innerObject)[0];
        let columnValue = innerObject[sequelizeOperator];
        let filter = {
          column: columnKey
        };
        if (sequelizeOperator === '$eq') {
          filter.operator = 'is exactly';
          filter.ignoreCase = false;
          filter.value = columnValue;
        } else if (sequelizeOperator === '$iLike') {
          filter.ignoreCase = true;
          if (columnValue.includes('\\%')) {
            filter.operator = 'like';
            filter.value = columnValue.replace('\\%', '%');
          } else {
            // Convert to mask to process all 4 possible combinations
            let startsWithPercent = '' + (+/^%/.test(columnValue));
            let endsWithPercent = '' + (+/%$/.test(columnValue));
            switch (startsWithPercent + endsWithPercent) {
              case '00':
                filter.operator = 'is exactly';
                filter.value = columnValue.replace('\\%', '%');
                break;
              case '01':
                filter.operator = 'begins with';
                filter.value = columnValue.replace(/%$/, '').replace('\\%', '%');
                break;
              case '10':
                filter.operator = 'ends with';
                filter.value = columnValue.replace(/^%/, '').replace('\\%', '%');
                break;
              case '11':
                filter.operator = 'contains';
                filter.value = columnValue.replace(/^%/, '').replace(/%$/, '').replace('\\%', '%');
                break;
            }
          }
        } else {
          throw new Error(`Expected key to be "$eq" or "$iLike", got "${sequelizeOperator}"`);
        }
        return filter;
      });
    }

    this.getDataSources().then(() => {
      this.isLoading = false;
    }).catch(() => {
      this.isLoading = false;
    });

    Fliplet.Widget.autosize();
  },
  updated() {
    Vue.nextTick(() => {
      if (!this.dataSourceProvider) {
        const dataSourceID = initialResult && initialResult.dataSourceId;

        this.initDataSourceProvider(dataSourceID);
      }
    });
  },
  data: {
    isLoading: true,
    selectedDataSource: null,
    selectedColumns: getInitialColumns(),
    applyFilters: getInitialFilters(),
    showFilters: false,
    showModesSelector: settings.modes.length > 1,
    operators: ['is exactly', 'contains', 'begins with', 'ends with', 'like'],
    loadingError: null,
    filters: [],
    modesDescription: settings.modesDescription,
    dataSourceProvider: null,
    modes: settings.modes,
    selectedModeIdx: (initialResult && initialResult.selectedModeIdx) ? initialResult.selectedModeIdx : 0,
    manageDataBtn: false
  },
  computed: {
    selectedMode() {
      return settings.modes[this.selectedModeIdx]
    },
    columnWarning() {
      let message = '-- ';

      if (this.selectedDataSource) {
        message += 'No columns/fields found';
      } else {
        message += 'Please select a data source';
      }
      return message;
    },
    typeaheadData() {
      let columns = this.selectedDataSource.columns;
      let bloodhound = new Bloodhound({
        datumTokenizer: Bloodhound.tokenizers.obj.whitespace('name'),
        queryTokenizer: Bloodhound.tokenizers.whitespace,
        local: columns ? columns.map((entry, index) => ({id: index, name: entry})) : [],
        identify: (obj) => obj.id
      });
      bloodhound.initialize();
      return {
        typeaheadjs: {
          name: 'columns',
          displayKey: 'name',
          valueKey: 'name',
          source: bloodhound.ttAdapter()
        }
      };
    },
    result() {
      try {
        let columns = this.selectedColumns;
        let columnsCompact = [];
        for (let key in columns) {
          if (columns.hasOwnProperty(key)) {
            let val = columns[key];
            if (val && val.length) {
              if (typeof val === 'object') {
                for (let entry of val) {
                  columnsCompact.push(entry);
                }
              } else {
                columnsCompact.push(val);
              }
            }
          }
        }
        let filterData = [];
        if (this.applyFilters) {
          for (let filter of this.filters) {
            let filterDataEntry;
            switch (filter.operator) {
              case 'is exactly': {
                if (filter.ignoreCase) {
                  filterDataEntry = {
                    $iLike: filter.value.replace('%', '\\%')
                  };
                } else {
                  filterDataEntry = {
                    $eq: filter.value
                  };
                }
                break;
              }
              case 'contains': {
                filterDataEntry = {
                  $iLike: `%${filter.value.replace('%', '\\%')}%`
                };
                break;
              }
              case 'begins with': {
                filterDataEntry = {
                  $iLike: `${filter.value.replace('%', '\\%')}%`
                };
                break;
              }
              case 'ends with': {
                filterDataEntry = {
                  $iLike: `%${filter.value.replace('%', '\\%')}`
                };
                break;
              }
              case 'like': {
                filterDataEntry = {
                  $iLike: filter.value.slice(0, 1) + filter.value.slice(1, -1).replace('%', '\\%') + filter.value.slice(-1)
                };
                break;
              }
            }
            filterData.push({
              [filter.column]: filterDataEntry
            });
          }
        }
        return {
          applyFilters: this.applyFilters,
          hideFilters: this.hideFilters,
          dataSourceId: this.selectedDataSource.id,
          selectedModeIdx: this.selectedModeIdx,
          filters: {
            $and: filterData
          },
          columns: columns,
          columnsCompact: columnsCompact
        };
      } catch (e) {
        return `Unable to compute result: ${e}`;
      }
    }
  },
  watch: {
    filters(arr) {
      if (arr.length === 0 && this.showFilters && this.selectedDataSource) {
        this.addDefaultFilter();
      }
      this.onSelectChange();
    },
    selectedColumns() {
      this.onSelectChange();
    },
    selectedDataSource(dataSource, oldValue) {
      this.onSelectChange();
      if (oldValue && dataSource && dataSource.id !== oldValue.id) {
        // Reset selected columns and filters if switching from a non-null value
        this.selectedColumns = {};
        this.filters = [];
      }

      Fliplet.Widget.emit('data-source-changed', dataSource);
    },
    applyFilters(val) {
      if (val === true && this.filters.length === 0) {
        this.addDefaultFilter();
      }
      this.showFilters = val;
      this.onSelectChange();
    },
    selectedModeIdx(val) {
      Vue.nextTick(() => Fliplet.Widget.autosize());
      Fliplet.Widget.emit('mode-changed', val);
    },
    showFilters() {
      this.onSelectChange();
    }
  },
  methods: {
    initDataSourceProvider(currentDataSourceId) {
      let dataSourceData = {
        dataSourceTitle: settings.dataSourceTitle ? settings.dataSourceTitle : 'Select data source',
        dataSourceId: currentDataSourceId,
        appId: Fliplet.Env.get('appId'),
        default: _.extend({
          name: `Data for ${Fliplet.Env.get('appName')}`,
          entries: [],
          columns: []
        }, settings.default),
        accessRules: accessRules
      };

      this.dataSourceProvider = Fliplet.Widget.open('com.fliplet.data-source-provider', {
        selector: '#dataSourceProvider',
        data: dataSourceData,
        onEvent: (event, dataSource) => {
          if (event === 'dataSourceSelect') {
            this.selectedDataSource = dataSource;
          }
        }
      });
    },
    onSelectChange(){
      Vue.nextTick(() => {
        $('select.hidden-select').trigger('change');
        Fliplet.Widget.autosize();
      });
    },
    toggleFilters(show) {
      if (typeof show === 'undefined') {
        this.showFilters = !this.showFilters;
        return
      }
      this.showFilters = show;
    },
    getDataSources() {
      return Fliplet.DataSources.get({
        type: null
      }, {
        cache: false
      })
        .then((data) => {
          this.loadingError = null;

          if (initialResult) {
            this.selectedDataSource = _.find(data, {id: initialResult.dataSourceId});
          }
        })
        .catch((err) => {
          console.error(err);
          this.loadingError = err;
        });
    },
    addDefaultFilter() {
      this.filters.push({
        column: this.selectedDataSource.columns[0],
        operator: 'is exactly',
        value: '',
        ignoreCase: false
      });
      Vue.nextTick(() => {
        $('select.hidden-select').trigger('change');
        window.scrollTo(0, document.body.scrollHeight);
      });
    },
    updateSelectedColumns(key, val) {
      let newSelectedColumns = Object.assign({}, this.selectedColumns);
      if (val && val.length) {
        newSelectedColumns[key] = val;
      } else {
        delete newSelectedColumns[key];
      }
      this.selectedColumns = newSelectedColumns;
    },
    manageDataSource: function (dataSourceId) {
      Fliplet.Studio.emit('overlay', {
        name: 'widget',
        options: {
          size: 'large',
          package: 'com.fliplet.data-sources',
          title: 'Edit Data Sources',
          classes: 'data-source-overlay',
          data: {
            context: 'overlay',
            dataSourceId: dataSourceId
          }
        }
      });
    }
  },
  components: {
    tagsinput: {
      template: `<input type="text" class="form-control" value="" :trigger-update="tagsinputData"/>`,
      props: ['tagsinputData', 'field', 'updateSelectedColumns', 'initArr'],
      mounted() {
        let $el = $(this.$el).change((event) => this.updateSelectedColumns(this.field.key, $el.tagsinput('items')));
        $el.tagsinput(this.tagsinputData);
        if (this.initArr) {
          $el.tagsinput('add', this.initArr.join(','));
        }
      },
      updated() {
        let $el = $(this.$el);
        $el.tagsinput('removeAll');
        $el.tagsinput('destroy');
        $el.tagsinput(this.tagsinputData);
      }
    }
  }
});

// Fired when the external save button is clicked
Fliplet.Widget.onSaveRequest(() => {
  // Send back the result
  Fliplet.Widget.save(JSON.parse(JSON.stringify(app.result))).then(() => {
    // Tell the UI this widget has finished
    Fliplet.Widget.complete();
  });
});
