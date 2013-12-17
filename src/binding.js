var make_node = function(item) { // Check if the argument is a DOM node or create a new textual node with its contents
		if(isAnyElement(item)) {
			return item;
		} else {
			var node = doc.createTextNode(item);
			return node;
		}
	},
	insert_at = function(child_node, parent_node, index) {
		// Utility function to insert child_node as the index-th child of parent_node
		var children = parent_node.childNodes;
		if(children.length <= index) {
			parent_node.appendChild(child_node);
		} else {
			var before_child = children[index];
			parent_node.insertBefore(child_node, before_child);
		}
	},
	remove_node = function(child_node) {
		// Utility to remove a child DOM node
		var parentNode = child_node.parentNode;
		if(parentNode !== null) {
			parentNode.removeChild(child_node);
		}
	},
	remove_index = function(parent_node, index) {
		// Utility to remove a child DOM node by index
		var children = parent_node.childNodes, child_node;
		if(children.length > index) {
			child_node = children[index];
			remove_node(child_node);
		}
	},
	move_child = function(parent_node, to_index, from_index) {
		// Utility to move a child DOM node by indicies
		var children = parent_node.childNodes;
		if(children.length > from_index) {
			var child_node = children[from_index];
			if(parent_node) {
				if(from_index < to_index) { //If it's less than the index we're inserting at...
					to_index++; //Increase the index by 1, to make up for the fact that we're removing me at the beginning
				}
				insert_at(child_node, parent_node, to_index);
			}
		}
	},
	// Check if jQuery is available
	is_jquery_obj = function(x) {
		return has(root, "jQuery") ? (x instanceof root.jQuery) : false;
	},
	nList = root.NodeList || false,
	// a node list is what is returned when you call getElementsByTagName, etc.
	isNList = nList ? function(x) { return x instanceof nList; } : function() { return false; },
	// Convert an object that can be passed into a binding into an array of dom elements
	get_dom_array = function(obj) {
		if(isArray(obj)) { // already an array
			return obj;
		} else if (is_constraint(obj)) { // regular constraint
			return get_dom_array(obj.get());
		} else if(is_array(obj)) { // array constraint
			return obj.toArray();
		} else if(is_map(obj)) { // map constraint
			return obj.values();
		} else if(is_jquery_obj(obj)) { // jquery object
			return root.jQuery.makeArray(obj);
		} else if(isNList(obj)) { // node list
			return toArray(obj);
		} else { // hopefully just an element; return its value as an array
			return [obj];
		}
	};

/**
 * A binding calls some arbitrary functions passed into options. It is responsible for keeping some aspect of a
 * DOM node in line with a constraint value. For example, it might keep an element's class name in sync with a
 * class_name constraint
 *
 * @private
 * @class Binding
 * @param {object} options
 * @classdesc Bind a DOM node property to a constraint value
 */
var Binding = function(options) {
	var targets = options.targets, // the DOM nodes
		onAdd = options.onAdd, // optional function to be called when a new target is added
		onRemove = options.onRemove, // optional function to be called when a target is removed
		onMove = options.onMove, // optional function to be called when a target is moved
		setter = options.setter, // a function that sets the attribute value
		getter = options.getter, // a function that gets the attribute value
		init_val = options.init_val, // the value of the attribute before the binding was set
		curr_value, // used in live fn
		last_value, // used in live fn
		old_targets = [], // used in live fn
		onDestroy = options.onDestroy, // a function to be called when the binding is destroyed
		// create a separate function to 
		do_update = function() {
			this._timeout_id = false; // Make it clear that I don't have a timeout set
			var new_targets = filter(get_dom_array(targets), isAnyElement); // update the list of targets

			if(onAdd || onRemove || onMove) { // If the user passed in anything to call when targets change, call it
				var diff = get_array_diff(old_targets, new_targets);
				each(onRemove && diff.removed, function(removed) { onRemove(removed.from_item, removed.from); });
				each(onAdd && diff.added, function(added) { onAdd(added.item, added.to); });
				each(onMove && diff.moved, function(moved) { onMove(moved.item, moved.to_index, moved.from_index); });
				old_targets = new_targets;
			}

			// For every target, update the attribute
			each(new_targets, function(target) {
				setter(target, curr_value, last_value);
			});

			// track the last value so that next time we call diff
			last_value = curr_value;
		};

	this.onDestroy = onDestroy;
	this._throttle_delay = false; // Optional throtling to improve performance
	this._timeout_id = false; // tracks the timeout that helps throttle

	if(isFunction(init_val)) { // If init_val is a getter, call it on the first element
		last_value = init_val(get_dom_array(targets[0]));
	} else { // Otherwise, just take it as is
		last_value = init_val;
	}

	this.$live_fn = cjs.liven(function() {
		curr_value = getter(); // get the value once and inside of live fn to make sure a dependency is added

		if(this._throttle_delay) { // We shouldn't update values right away
			if(!this._timeout_id) { // If there isn't any timeout set yet, then set a timeout to delay the call to do update
				this._timeout_id = sTO(bind(do_update, this), this._throttle_delay);
			}
		} else { // we can update the value right away if no throttle delay is set
			do_update.call(this);
		}
	}, {
		context: this
	});
};

(function(my) {
	/** @lends Binding.prototype */
	var proto = my.prototype;
	/**
	 * Pause binding (no updates to the attribute until resume is called)
	 *
	 * @method pause
	 * @return {Binding} `this`
	 * @see resume
	 * @see throttle
	 */
	proto.pause = function() { this.$live_fn.pause(); return this; };

	/**
	 * Resume binding (after pause)
	 *
	 * @method resume
	 * @return {Binding} `this`
	 * @see pause
	 * @see throttle
	 */
	proto.resume = function() { this.$live_fn.resume(); return this; };


	/**
	 * Require at least `min_delay` milliseconds between setting the attribute
	 *
	 * @method throttle
	 * @param {number} min_delay - The minimum number of milliseconds between updates
	 * @return {Binding} `this`
	 * @see pause
	 * @see resume
	 */
	proto.throttle = function(min_delay) {
		this._throttle_delay = min_delay > 0 ? min_delay : false; // Make sure it's positive
		if(this._timeout_id && !this._throttle_delay) { // If it was speicfied that there should be no delay and we are waiting for a re-eval
			cTO(this._timeout_id); // then prevent that re-eval
			this._timeout_id = false;
		}
		// regardless, run the live fn again
		this.$live_fn.run();
		return this;
	};

	/**
	 * Stop updating the binding and try to clean up any memory
	 *
	 * @method destroy
	 * @see pause
	 * @see resume
	 * @see throttle
	 */
	proto.destroy = function() {
		this.$live_fn.destroy();
		if(this.onDestroy) {
			this.onDestroy();
		}
	};
}(Binding));
/** @lends */

// Creates a type of binding that accepts any number of arguments and then sets an attribute's value to depend on
// every element that was passed in
var create_list_binding = function(list_binding_getter, list_binding_setter, list_binding_init_value) {
		return function(elements) { // The first argument is a list of elements
			var args = slice.call(arguments, 1), // and the rest are values
				val = cjs(function() { // Create a constraint so that the binding knows of any changes
					return list_binding_getter(args);
				});

			var binding = new Binding({
				targets: elements,
				getter: bind(val.get, val), // use the constraint's value as the getter
				setter: list_binding_setter,
				init_val: list_binding_init_value,
				onDestroy: function() {
					val.destroy(); // Clean up the constraint when we are done
				}
			});
			return binding;
		};
	},
	create_textual_binding = function(setter) { // the text value of a node is set to the concatenation of every argument
		return create_list_binding(function(args) {
			return map(args, cjs.get).join("");
		}, function(element, value) {
			setter(element, value);
		});
	},
	// a binding that accepts either a key and a value or an object with any number of keys and values
	create_obj_binding = function(obj_binding_setter) {
		return function(elements) {
			var vals,
				args = slice.call(arguments, 1);
			if(args.length === 0) { // need at least one argument
				return;
			} else if(args.length === 1) { // an object with keys and values was passed in
				vals = args[0];
			} else if(args.length > 1) { // the first argument was the key, the second was a value
				vals = {};
				vals[args[0]] = args[1];
			}

			var binding = new Binding({
				targets: elements,
				setter: function(element, value) {
					each(value, function(v, k) {
						obj_binding_setter(element, k, v);
					});
				},
				getter: function() {
					if(is_map(vals)) {
						return vals.toObject();
					} else {
						var rv = {};
						each(vals, function(v, k) {
							rv[k] = cjs.get(v);
						});
						return rv;
					}
				}
			});

			return binding;
		};
	};

	/**
	 * Constrain a DOM node's text content
	 *
	 * @method cjs.text
	 * @param {dom} element - The DOM element
	 * @param {...*} values - The desired text value
	 * @return {Binding} - A binding object
	 */
var text_binding = create_textual_binding(function(element, value) { // set the escaped text of a node
		element.textContent = value;
	}),

	/**
	 * Constrain a DOM node's HTML content
	 *
	 * @method cjs.html
	 * @param {dom} element - The DOM element
	 * @param {...*} values - The desired html content
	 * @return {Binding} - A binding object
	 */
	html_binding = create_textual_binding(function(element, value) { // set the non-escaped inner HTML of a node
		element.innerHTML = value;
	}),

	/**
	 * Constrain a DOM node's value
	 *
	 * @method cjs.val
	 * @param {dom} element - The DOM element
	 * @param {...*} values - The value the element should have
	 * @return {Binding} - A binding object
	 */
	val_binding = create_textual_binding(function(element, value) { // set the value of a ndoe
		element.val = value;
	}),

	/**
	 * Constrain a DOM node's class names
	 *
	 * @method cjs.class
	 * @param {dom} element - The DOM element
	 * @param {...*} values - The list of classes the element should have. The binding automatically flattens them.
	 * @return {Binding} - A binding object
	 */
	class_binding = create_list_binding(function(args) { // set the class of a node
		return flatten(map(args, cjs.get), true);
	}, function(element, value, old_value) {
		// Compute difference so that old class values remain
		var ad = get_array_diff(old_value, value),
			curr_class_name = " " + element.className + " "; // add spaces so that the replace regex doesn't need extra logic

		// take out all of the removed classes
		each(ad.removed, function(removed_info) { curr_class_name = curr_class_name.replace(" " + removed_info.from_item + " ", " "); });
		// and add all of the added classes
		curr_class_name += map(ad.added, function(x) { return x.item; }).join(" ");

		curr_class_name = curr_class_name.trim(); // and trim to remove extra spaces

		element.className = curr_class_name; // finally, do the work of setting the class
	}, []), // say that we don't have any classes to start with

	/**
	 * Constrain a DOM node's children
	 *
	 * @method cjs.children
	 * @param {dom} element - The DOM element
	 * @param {...*} elements - The elements to use as the constraint. The binding automatically flattens them.
	 * @return {Binding} - A binding object
	 */
	children_binding = create_list_binding(function(args) {
		var arg_val_arr = map(args, cjs.get);
		return map(flatten(arg_val_arr, true), make_node);
	}, function(element, value, old_value) {
		var ad = get_array_diff(old_value, value);
		each(ad.removed, function(removed_info) { remove_index(element, removed_info.from); });
		each(ad.added, function(added_info) { insert_at(added_info.item, element, added_info.to); });
		each(ad.moved, function(moved_info) { move_child(element, moved_info.to_index, moved_info.from_index); });
	}, function(element) {
		return toArray(element.childNodes);
	}),

	/**
	 * Constrain a DOM node's CSS style
	 *
	 * @method cjs.css
	 * @param {dom} element - The DOM element
	 * @param {object} values - An object whose key-value pairs are the CSS property names and values respectively
	 * @return {Binding} - A binding object representing the link from constraints to CSS styles
	 */
	/**
	 * Constrain a DOM node's CSS style
	 *
	 * @method cjs.css^2
	 * @param {string} key - The name of the CSS attribute to constraint
	 * @param {cjs.Constraint|string} value - The value of this CSS attribute
	 * @return {Binding} - A binding object representing the link from constraints to elements
	 */
	css_binding = create_obj_binding(function(element, key, value) {
		element.style[camel_case(key)] = value;
	}),

	/**
	 * Constrain a DOM node's attribute values
	 *
	 * @method cjs.attr
	 * @param {dom} element - The DOM element
	 * @param {object} values - An object whose key-value pairs are the attribute names and values respectively
	 * @return {Binding} - A binding object representing the link from constraints to elements
	 */
	/**
	 * Constrain a DOM node's attribute value
	 *
	 * @method cjs.attr^2
	 * @param {string} key - The name of the attribute to constraint
	 * @param {cjs.Constraint|string} value - The value of this attribute
	 * @return {Binding} - A binding object representing the link from constraints to elements
	 */
	attr_binding = create_obj_binding(function(element, key, value) {
		element.setAttribute(key, value);
	});

var inp_change_events = ["keyup", "input", "paste", "propertychange", "change"],
	/**
	 * Take an input element and create a constraint whose value is constrained to the value of that input element
	 *
	 * @method cjs.inputValue
	 * @param {dom} inp - The input element
	 * @return {cjs.Constraint} - A constraint whose value is the input's value
	 */
	getInputValueConstraint = function(inps) {
		var arr_inp; // tracks if the input is a list of items
		if(isElement(inps)) {
			inps = [inps];
			arr_inp = false;
		} else {
			arr_inp = true;
		}
		// the constraint should just return the value of the input element
		var constraint = cjs(function() {
				if(arr_inp) {
					return map(inps, function(inp) { return inp.value; }); // if it's an array, return every value
				} else {
					return inps[0].value; // otherwise, just reutrn the first value
				}
			}),
			len = inps.length,
			on_change = bind(constraint.invalidate, constraint), // when any input event happens, invalidate the constraint
			activate = function() { // add all the event listeners for every input and event type
				each(inp_change_events, function(event_type) {
					each(inps, function(inp) {
						inp.addEventListener(event_type, on_change);
					});
				});
			},
			deactivate = function() { // clear all the event listeners for every input and event type
				each(inp_change_events, function(event_type) {
					each(inps, function(inp) {
						inp.removeEventListener(event_type, on_change);
					});
				});
			},
			oldDestroy = constraint.destroy;

		// when the constraint is destroyed, remove the event listeners
		constraint.destroy = function() {
			deactivate();
			oldDestroy.call(constraint);
		};

		activate();
		return constraint;
	};

extend(cjs, {
	/** @expose cjs.text */
	text: text_binding,
	/** @expose cjs.html */
	html: html_binding,
	/** @expose cjs.val */
	val: val_binding,
	/** @expose cjs.children */
	children: children_binding,
	/** @expose cjs.attr */
	attr: attr_binding,
	/** @expose cjs.css */
	css: css_binding,
	/** @expose cjs.class */
	"class": class_binding,
	/** @expose cjs.inputValue */
	inputValue: getInputValueConstraint
});
