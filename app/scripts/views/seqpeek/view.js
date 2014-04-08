define([
    "jquery", "underscore", "backbone", "d3", "vq",
    "models/gs/protein_domain_model",
    "seqpeek/util/data_adapters",
    "seqpeek/builders/builder_for_existing_elements",
    "hbs!templates/seqpeek/mutations_map",
    "hbs!templates/seqpeek/mutations_map_table"
],
    function ($, _, Backbone, d3, vq,
              ProteinDomainModel, SeqPeekDataAdapters, SeqPeekBuilder, MutationsMapTpl, MutationsMapTableTpl) {
        var VARIANT_TRACK_MAX_HEIGHT = 150;
        var TICK_TRACK_HEIGHT = 25;
        var REGION_TRACK_HEIGHT = 10;
        var PROTEIN_DOMAIN_TRACK_HEIGHT = 40;
        var VIEWPORT_WIDTH = 1000;

        var GROUP_BY_CATEGORIES = {
            "Mutation Type": "mutation_type",
            "DNA Change": "dna_change",
            "Protein Change": function(data_row) {
                return data_row["amino_acid_mutation"] + "-" + data_row["amino_acid_wildtype"];
            }
        };

        var MUTATION_TYPE_COLOR_MAP = {
            Nonsense_Mutation: "red",
            Silent: "green",
            Frame_Shift_Del: "gold",
            Frame_Shift_Ins: "gold",
            Missense_Mutation: "blue"
        };

        var LOLLIPOP_COLOR_SCALE = d3.scale.category20();

        var COLOR_BY_CATEGORIES = {
            "Mutation Type": function(data_point) {
                return MUTATION_TYPE_COLOR_MAP[data_point["mutation_type"]];
            },
            "DNA Change": function(data_point) {
                return LOLLIPOP_COLOR_SCALE(data_point["dna_change"]);
            },
            "Protein Change": function(data_point) {
                var id = data_point["amino_acid_mutation"] + "-" + data_point["amino_acid_wildtype"];
                return LOLLIPOP_COLOR_SCALE(id);
            }
        };

        return Backbone.View.extend({
            "genes": [],
            "tumor_types": [],
            "model": {},

            events: {
                "click .seqpeek-gene-selector li a": function(e) {
                    console.debug("seqpeek/gene-selector:" + $(e.target).data("id"));
                    this.selected_gene = $(e.target).data("id");
                    this.$el.find(".selected-gene").html(this.selected_gene);
                    this.__render();
                },

                "click .seqpeek-group-by-selector li a": function(e) {
                    console.debug("seqpeek/group-by-selector:" + $(e.target).data("id"));
                    var selected_value = $(e.target).data("id");
                    this.selected_group_by = GROUP_BY_CATEGORIES[selected_value];
                    this.$el.find(".selected-group-by").html(selected_value);
                    this.__render();
                }
            },

            initialize: function () {
                this.model = this.options["models"];

                this.sample_track_type = "sample_plot";
            },

            render: function() {
                console.debug("seqpeek/view.render");

                this.tumor_types = this.options["tumor_types"];
                this.genes = this.options["genes"] || [];
                if (!_.isEmpty(this.genes)) this.selected_gene = _.first(this.genes);
                this.selected_group_by = _.first(_.values(GROUP_BY_CATEGORIES));

                var renderFn = _.after(1 + (2 * this.tumor_types.length), this.__load_protein_domains);

                this.model["mutsig"].on("load", renderFn, this);

                _.each(this.model["mutations"]["by_tumor_type"], function(model) {
                    model.on("load", renderFn, this);
                }, this);
                _.each(this.model["mutated_samples"]["by_tumor_type"], function(model) {
                    model.on("load", renderFn, this);
                }, this);

                this.$el.html(MutationsMapTpl({
                    "selected_gene": this.selected_gene,
                    "genes": this.genes,
                    "selected_group_by": "Mutation Type",
                    "group_by_categories": _.keys(GROUP_BY_CATEGORIES)}));

                this.$(".mutations_map_table").html(MutationsMapTableTpl({
                    "items": _.map(this.tumor_types, function (tumor_type) {
                        return { "tumor_type_label": tumor_type };
                    })
                }));

                return this;
            },

            __render: function () {
                console.debug("seqpeek/view.__render");

                this.$(".mutations_map_table").html("");

                var mutations = this.__filter_data(this.__parse_mutations());
                var mutsig_ranks = this.__filter_data(this.__parse_mutsig());

                var formatter = function (value) {
                    return parseInt(value) + "%";
                };

                var data_items = _.map(this.tumor_types, function (tumor_type) {
                    var statistics = {
                        samples: {
                            numberOf: 0,
                            totals: {
                                percentOf: "NA"
                            }
                        }
                    };

                    if (_.has(mutations, tumor_type)) {
                        statistics.samples.numberOf = _.chain(mutations[tumor_type])
                            .pluck('patient_id')
                            .unique()
                            .value()
                            .length;
                    }

                    var by_tumor_type = this.model["mutated_samples"]["by_tumor_type"];
                    if (by_tumor_type) {
                        var tt_model = by_tumor_type[tumor_type];
                        if (tt_model) {
                            var totals_per_gene_array = tt_model.get("items");
                            if (!_.isEmpty(totals_per_gene_array)) {
                                var stats_for_gene = _.findWhere(totals_per_gene_array, { "gene": this.selected_gene });
                                if (stats_for_gene && _.has(stats_for_gene, "numberOf")) {
                                    var total = stats_for_gene["numberOf"];
                                    if (_.isNumber(total)) {
                                        statistics.samples.totals = {
                                            percentOf: "NA"
                                        };
                                    }
                                }
                            }
                        }
                    }

                    var mutsig_rank;
                    if (_.has(mutsig_ranks, tumor_type)) {
                        var mutsig_data = mutsig_ranks[tumor_type];
                        if (!_.isEmpty(mutsig_data)) {
                            mutsig_rank = _.first(mutsig_data)["rank"];
                        }
                    }

                    return {
                        tumor_type_label: tumor_type,
                        tumor_type: tumor_type,
                        mutsig_rank: mutsig_rank,
                        statistics: statistics
                    };
                }, this);

                this.$(".mutations_map_table").html(MutationsMapTableTpl({ "items": data_items }));

                var seqpeek_data = [];

                var uniprot_id = this.gene_to_uniprot_mapping[this.selected_gene];
                var protein_data = this.found_protein_domains[uniprot_id];

                var region_data = [ { "type": "exon", "start": 0, "end": protein_data["length"] } ];

                _.each(this.tumor_types, function (tumor_type) {
                    var variants = mutations[tumor_type];
                    if (_.isEmpty(variants)) return;

                    seqpeek_data.push({
                        variants: variants,
                        tumor_type: tumor_type,
                        target_element: _.first(this.$("#seqpeek-row-" + tumor_type))
                    });
                }, this);

                var seqpeek_tick_track_element = _.first(this.$("#seqpeek-tick-element"));
                var seqpeek_domain_track_element = _.first(this.$("#seqpeek-protein-domain-element"));

                var maximum_samples_in_location = this.__find_maximum_samples_in_location(seqpeek_data);
                if (maximum_samples_in_location >= this.options.bar_plot_threshold) {
                    this.sample_track_type = "bar_plot";
                }

                this.__render_tracks(seqpeek_data, region_data, protein_data, seqpeek_tick_track_element, seqpeek_domain_track_element);
            },

            __render_tracks: function(mutation_data, region_array, protein_data, seqpeek_tick_track_element, seqpeek_domain_track_element) {
                console.debug("seqpeek/view.__render_tracks");



                var seqpeek = SeqPeekBuilder.create({
                    region_data: region_array,
                    viewport: {
                        width: VIEWPORT_WIDTH
                    },
                    bar_plot_tracks: {
                        bar_width: 5.0,
                        height: VARIANT_TRACK_MAX_HEIGHT,
                        stem_height: 30,
                        color_scheme: function(category_name, type_name) {
                            return MUTATION_TYPE_COLOR_MAP[type_name];
                        }
                    },
                    sample_plot_tracks: {
                        height: VARIANT_TRACK_MAX_HEIGHT,
                        stem_height: 30,
                        color_scheme: function(data_point) {
                            return MUTATION_TYPE_COLOR_MAP[data_point["mutation_type"]];
                        }
                    },
                    region_track: {
                        height: REGION_TRACK_HEIGHT
                    },
                    protein_domain_tracks: {
                        source_key: "dbname",
                        source_order: ["PFAM", "SMART", "PROFILE"],
                        color_scheme: {
                            "PFAM": "lightgray",
                            "SMART": "darkgray",
                            "PROFILE": "gray"
                        }
                    },
                    tick_track: {
                        height: TICK_TRACK_HEIGHT
                    },
                    region_layout: {
                        intron_width: 5,
                        exon_width: VIEWPORT_WIDTH
                    },
                    variant_layout: {
                        variant_width: 5.0
                    },
                    variant_data_location_field: "amino_acid_position",
                    variant_data_type_field: this.selected_group_by
                });

                _.each(mutation_data, function(track_obj) {
                    var track_guid = "C" + vq.utils.VisUtils.guid();
                    var track_elements_svg = d3.select(track_obj.target_element)
                        .append("svg")
                        .attr("width", VIEWPORT_WIDTH)
                        .attr("height", VARIANT_TRACK_MAX_HEIGHT + REGION_TRACK_HEIGHT)
                        .attr("id", track_guid)
                        .style("pointer-events", "none");

                    var sample_plot_track_g = track_elements_svg
                        .append("g")
                        .style("pointer-events", "none");

                    var region_track_g = track_elements_svg
                        .append("g")
                        .style("pointer-events", "none");

                    track_obj.track_info = this.__add_data_track(track_obj, seqpeek, track_guid, sample_plot_track_g);
                    track_obj.variant_track_svg = track_elements_svg;

                    seqpeek.addRegionScaleTrackToElement(region_track_g, {
                        guid: track_guid,
                        hovercard_content: {
                            "Protein length": function () {
                                return protein_data["length"];
                            },
                            "Name": function () {
                                return protein_data["name"];
                            },
                            "UniProt ID": function () {
                                return protein_data["uniprot_id"];
                            }
                        }
                    });

                    track_obj.region_track_svg = region_track_g;
                }, this);

                var tick_track_svg = d3.select(seqpeek_tick_track_element)
                    .append("svg")
                    .attr("width", VIEWPORT_WIDTH)
                    .attr("height", TICK_TRACK_HEIGHT)
                    .style("pointer-events", "none");

                seqpeek.addTickTrackToElement(tick_track_svg);

                var protein_domain_track_guid = "C" + vq.utils.VisUtils.guid();
                var protein_domain_track_svg = d3.select(seqpeek_domain_track_element)
                    .append("svg")
                    .attr("width", VIEWPORT_WIDTH)
                    .attr("height", PROTEIN_DOMAIN_TRACK_HEIGHT)
                    .attr("id", protein_domain_track_guid)
                    .style("pointer-events", "none");

                seqpeek.addProteinDomainTrackToElement(protein_data["matches"], protein_domain_track_svg, {
                    guid: protein_domain_track_guid,
                    hovercard_content: {
                        "DB": function(d) {
                            return d.dbname;
                        },
                        "EVD": function(d) {
                            return d.evd;
                        },
                        "ID": function(d) {
                            return d.id;
                        },
                        "Name": function(d) {
                            return d.name;
                        },
                        "Status": function(d) {
                            return d.status;
                        },
                        "LOC": function(d) {
                            return d.start + " - " + d.end;
                        }
                    }
                });

                seqpeek.createInstances();

                _.each(mutation_data, function(track_obj) {
                    var track_info = track_obj.track_info;
                    var track_instance = track_info.track_instance;

                    track_instance.setHeightFromStatistics();
                    var variant_track_height = track_instance.getHeight();
                    var total_track_height = variant_track_height + REGION_TRACK_HEIGHT;

                    track_obj.variant_track_svg.attr("height", total_track_height);
                    track_obj.region_track_svg
                        .attr("transform", "translate(0," + (variant_track_height) + ")")
                });

                seqpeek.render();
            },

            __find_maximum_samples_in_location: function(mutation_data) {
                var track_maximums = [];
                _.each(mutation_data, function(track_obj) {
                    var grouped_data = SeqPeekDataAdapters.group_by_location(track_obj.variants, "mutation_type", "amino_acid_position");
                    SeqPeekDataAdapters.apply_statistics(grouped_data, function() {return 'all';});

                    var max_number_of_samples_in_position = d3.max(grouped_data, function(data_by_location) {
                        return d3.max(data_by_location["types"], function(data_by_type) {
                            return data_by_type.statistics.total;
                        });
                    });

                    track_maximums.push(max_number_of_samples_in_position);
                });

                return d3.max(track_maximums);
            },

            __add_data_track: function(track_obj, seqpeek_builder, track_guid, track_target_svg) {
                if (this.sample_track_type == "sample_plot") {
                     return seqpeek_builder.addSamplePlotTrackWithArrayData(track_obj.variants, track_target_svg, {
                        guid: track_guid,
                        hovercard_content: {
                            "Location": function (d) {
                                return d["amino_acid_position"];
                            },
                            "Amino Acid Mutation": function (d) {
                                return d["amino_acid_mutation"];
                            },
                            "Amino Acid Wildtype": function (d) {
                                return d["amino_acid_wildtype"];
                            },
                            "DNA change": function (d) {
                                return d["dna_change"];
                            },
                            "Type": function (d) {
                                return d["mutation_type"];
                            },
                            "Patient ID": function (d) {
                                return d["patient_id"];
                            },
                            "UniProt ID": function (d) {
                                return d["uniprot_id"];
                            }
                        }
                    });
                }
                else {
                    return seqpeek_builder.addBarPlotTrackWithArrayData(track_obj.variants, track_target_svg, {
                        guid: track_guid,
                        hovercard_content: {
                            "Location": function (d) {
                                return d["coordinate"];
                            },
                            "Type": function (d) {
                                return d["type"];
                            },
                            "Number": function (d) {
                                return d["statistics"]["total"];
                            }
                        }
                    });
                }
            },

            __filter_data: function(data_by_tumor_type) {
                console.debug("seqpeek/view.__filter_data:" + this.selected_gene);

                var lowercase_gene = this.selected_gene.toLowerCase();
                var filtered = {};
                _.each(data_by_tumor_type, function(data, tumor_type) {
                    if (_.isArray(data)) {
                        filtered[tumor_type] = _.filter(data, function(item) {
                            return (_.has(item, "gene") && _.isEqual(item["gene"].toLowerCase(), lowercase_gene));
                        }, this);
                    } else {
                        if (_.has(data, "gene") && _.isEqual(data["gene"], lowercase_gene)) {
                            filtered[tumor_type] = data;
                        }
                    }
                });
                return filtered;
            },

            __parse_mutations: function () {
                console.debug("seqpeek/view.__parse_mutations");

                var data = {};
                _.each(this.model["mutations"]["by_tumor_type"], function(model, tumor_type) {
                    data[tumor_type] = model.get("items");
                }, this);
                return data;
            },

            __parse_mutsig: function () {
                console.debug("seqpeek/view.__parse_mutsig");
                return _.reduce(this.model["mutsig"].get("items"), function (memo, feature) {
                    if (!_.has(memo, feature.cancer)) {
                        memo[feature.cancer] = [];
                    }
                    memo[feature.cancer].push(feature);
                    return memo;
                }, {});
            },

            __load_protein_domains: function() {
                console.debug("seqpeek/view.__load_protein_domains");
                this.gene_to_uniprot_mapping = this.__find_protein_identifiers();
                var protein_ids = _.values(this.gene_to_uniprot_mapping);

                var protein_domain_model = new ProteinDomainModel({}, {
                    data_source: {
                        uri: this.options.protein_domains
                    }
                });

                protein_domain_model.on("change", function(changed) {
                    this.found_protein_domains = changed.toJSON();
                    this.__render();
                }, this);

                protein_domain_model.fetch({
                    protein_ids: protein_ids,
                    error: function(xhr, textStatus, errorThrown){
                        console.log([xhr, textStatus, errorThrown]);
                    }
                });
            },

            __find_protein_identifiers: function() {
                console.debug("seqpeek/view.__find_protein_identifiers");
                var items = _.flatten(_.map(this.model["mutations"]["by_tumor_type"], function(model, tumor_type) {
                    return model.get("items");
                }));

                var gene_to_uniprot_mapping = _.reduce(items, function(memo, item) {
                    var gene_label = item["gene"];
                    if (!_.has(memo, gene_label)) {
                        memo[gene_label] = item["uniprot_id"];
                    }
                    return memo;
                }, {});

                return gene_to_uniprot_mapping;
            }
        });
    });
