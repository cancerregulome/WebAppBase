define(["jquery", "underscore", "backbone", "bootstrap",
    "views/topbar_view",
    "views/data_menu_modal",
    "views/data_menu_sections",
    "views/sessions_view",
    "views/gs/atlas"
],
    function ($, _, Backbone, Bootstrap, TopNavBar, DataMenuModal, DataMenuSections, SessionsView, AtlasView) {

        return Backbone.Router.extend({
            targetEl: "#mainDiv",
            routes: {
                "": "atlas",
                "v/*uri/:view_name": "viewsByUri",
                "s/*sessionId": "loadSessionById"
            },

            initialize: function (options) {
                if (options) _.extend(this, options);

                this.$el = $(this.targetEl);
            },

            views: {

            },

            initTopNavBar: function (params) {
                var topnavbar = new TopNavBar(params);
                $("#navigation-container").append(topnavbar.render().el);

                var dataMenuSectionsView = new DataMenuSections({
                    sections: _.map(_.keys(WebApp.Datamodel.attributes), function (section_id) {
                        return {
                            data: WebApp.Datamodel.get(section_id),
                            id: section_id
                        };
                    })
                });

                dataMenuSectionsView.on("select-data-item", function (selected) {
                    new DataMenuModal(_.extend({ el: $("#modal-container") }, selected));
                });

                $(".data-dropdown").append(dataMenuSectionsView.render().el);

                var sessionsView = new SessionsView();
                this.$el.find(".sessions-container").html(sessionsView.render().el);
            },

            loadSessionById: function (sessionId) {
                if (!_.isEmpty(sessionId)) {
                    var selectedSession = _.find(this.Sessions.All.models, function (m) {
                        return _.isEqual(m.get("id"), sessionId);
                    });
                    if (selectedSession) {
                        this.Sessions.Active = selectedSession;
                        var route = selectedSession.get("route");
                        if (!_.isEmpty(route)) {
                            this.navigate(route, {trigger: true});
                        }
                    }
                }
            },

            home_view: function () {
                // TODO
            },

            fetchAnnotations: function (dataset_id) {
                if (_.isEmpty(this.Annotations[dataset_id])) {
                    var annotations = new this.Models.Annotations({
                            "url": "svc/data/annotations/" + dataset_id + ".json",
                            "dataType": "json"}
                    );

                    annotations.fetch({
                        "async": false,
                        "dataType": "json",
                        "success": function () {
                            WebApp.Annotations[dataset_id] = annotations.get("itemsById");
                        }
                    });
                }
                return this.Annotations[dataset_id];
            },

            viewsByUri: function (uri, view_name, options) {
                var parts = uri.split("/");
                var data_root = parts[0];
                var analysis_id = parts[1];
                var dataset_id = parts[2];
                var model_unit = this.Datamodel.get(data_root)[analysis_id];
                var catalog = model_unit.catalog;
                var catalog_unit = catalog[dataset_id];
                var modelName = catalog_unit.model;
                var serviceUri = catalog_unit.service || model_unit.service || "data/" + uri;
                var Model = this.Models[modelName] || Backbone.Model;

                var model_optns = _.extend(options || {}, {
                    "url": "svc/" + serviceUri,
                    "data_uri": "svc/" + serviceUri, // deprecate data_uri
                    "analysis_id": analysis_id,
                    "dataset_id": dataset_id,
                    "model_unit": model_unit,
                    "catalog_unit": catalog_unit
                });

                this.fetchAnnotations(dataset_id);

                var model = new Model(model_optns);
                _.defer(function () {
                    model.fetch({
                        "url": model_optns["url"],
                        success: function () {
                            model.trigger("load");
                        }
                    });
                });

                var view_options = _.extend({"model": model}, (model_unit.view_options || {}), (options || {}));

                var ViewClass = this.Views[view_name];
                var view = new ViewClass(view_options);
                this.$el.html(view.render().el);
                return view;
            },

            atlas: function () {
                var model = new Backbone.Model();

                var view = new AtlasView({ "router": this, "model": model });
                this.$el.html(view.render().el);

                model.fetch({
                    "url": "configurations/atlas.json",
                    "success": function () {
                        model.trigger("load");
                    }
                });

                return view;
            }
        });
    });