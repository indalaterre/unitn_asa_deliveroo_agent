(define (domain deliveroo)
    (:requirements :strips)

    (:predicates
        (obstacle_position ?tile)
        (above ?from_tile ?to_tile)
        (belowe ?from_tile ?to_tile)
        (left ?from_tile ?to_tile)
        (right ?from_tile ?to_tile)
        (at ?tile)
    )

    (:action move_up
        :parameters (?from_tile ?to_tile)
        :precondition (and (at ?from_tile) (belowe ?to_tile ?from_tile) (not (obstacle_position ?to_tile)))
        :effect (and (not (at ?from_tile)) (at ?to_tile))
    )

    (:action move_down
        :parameters (?from_tile ?to_tile)
        :precondition (and (at ?from_tile) (above ?to_tile ?from_tile) (not (obstacle_position ?to_tile)))
        :effect (and (not (at ?from_tile)) (at ?to_tile))
    )

    (:action move_left
        :parameters (?from_tile ?to_tile)
        :precondition (and (at ?from_tile) (right ?to_tile ?from_tile) (not (obstacle_position ?to_tile)))
        :effect (and (not (at ?from_tile)) (at ?to_tile))
    )

    (:action move_right
        :parameters (?from_tile ?to_tile)
        :precondition (and (at ?from_tile) (left ?to_tile ?from_tile) (not (obstacle_position ?to_tile)))
        :effect (and (not (at ?from_tile)) (at ?to_tile))
    )
)