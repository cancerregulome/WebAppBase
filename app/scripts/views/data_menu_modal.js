define([
    "jquery", "underscore", "backbone",

    "hbs!templates/data_menu_modal",
    "hbs!templates/line_item"],
    function ($, _, Backbone, MenuModalTemplate, LineItemTemplate) {

        return Backbone.View.extend({

            initialize: function (options) {
                _.extend(this, options);

                this.renderData();
            },

            renderData: function () {
                this.$el.html(MenuModalTemplate());

                var sectionId = this.sectionId;
                var unitId = this.unitId;
                var itemId = this.itemId;

                var section = WebApp.Datamodel.get(sectionId);
                var catalog = section[unitId].catalog;
                var item = catalog[itemId];
                var views = WebApp.ViewMappings[item.model] || [
                    {"label": "Grid", "id": "grid"}
                ];

                this.$el.find(".modal-header h4").html(item.label);
                this.$el.find(".modal-body .info").html(item.description);
                var UL = this.$el.find(".data-links");
                _.each(views, function (view) {
                    UL.append(LineItemTemplate({ "label": view.label, "a_class": "selectable-link", "id": view.id }));
                });

                UL.find(".selectable-link").click(function (e) {
                    $("#modal-container").modal("hide");
                    WebApp.Router.navigate("#v/" + sectionId + "/" + unitId + "/" + itemId + "/" + $(e.target).data("id"), {trigger: true});
                });

                this.$el.modal("show");

                return this;
            }

        });
    });
